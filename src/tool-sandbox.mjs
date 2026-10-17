// Platform-portable driver for the tool sandbox.
//
// A single worker (src/sandbox/worker.mjs) runs tool code in an isolated Linux
// environment and talks back over stdio. Only the *launcher* differs:
//   - Windows: runs the worker inside WSL via wsl.exe.
//   - Linux:   runs the same worker natively (optionally inside bubblewrap).
import { spawn, spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import { spaceDir } from './space.mjs';
import { engineDir } from './home.mjs';

const SENTINEL = '@@MICRODOT@@';
const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';
const distro = () => process.env.MICRODOT_WSL_DISTRO || 'Ubuntu-24.04';
const workerPath = () => resolve(engineDir(), 'src/sandbox/worker.mjs');

// Host path <-> sandbox (Linux) path. Identity on Linux; drive-letter mapping
// to /mnt/<drive> on Windows.
export function hostToSandboxPath(p) {
  const s = String(p);
  if (!IS_WIN) return s;
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(s);
  if (!m) return s.replace(/\\/g, '/');
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}

export function sandboxToHostPath(p) {
  const s = String(p);
  if (!IS_WIN) return s;
  const m = /^\/mnt\/([a-z])\/(.*)$/i.exec(s);
  if (!m) return s;
  return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`;
}

function commandExists(cmd) {
  try {
    return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

function useBwrap() {
  return ['1', 'true'].includes(String(process.env.MICRODOT_SANDBOX_BWRAP ?? '').toLowerCase()) && !bwrapFailed;
}

// bubblewrap args: whole system read-only, workspace writable, no shared pid/ipc/uts.
function bwrapArgs(workspace, cwd) {
  return [
    '--die-with-parent',
    '--unshare-pid',
    '--unshare-ipc',
    '--unshare-uts',
    '--ro-bind', '/', '/',
    '--bind', workspace, workspace,
    '--dev', '/dev',
    '--proc', '/proc',
    '--tmpfs', '/tmp',
    '--chdir', cwd,
  ];
}

// The workspace (space dir) currently bind-mounted read-write by bwrap, in
// SANDBOX path form; null when the worker runs unconfined (no bind — the whole
// filesystem is writable). Used to detect a stale bind after the active project
// or space changes.
let boundWorkspace = null;

function workerCommand() {
  const worker = workerPath();
  const node = process.env.MICRODOT_NODE || 'node';
  if (IS_WIN) {
    const workerWsl = hostToSandboxPath(worker);
    if (useBwrap()) {
      const space = spaceDir(process.env.MICRODOT_AGENT || 'main');
      mkdirSync(space, { recursive: true });
      const workspace = hostToSandboxPath(space);
      boundWorkspace = workspace;
      const cwd = hostToSandboxPath(process.cwd());
      return { cmd: 'wsl.exe', bwrap: true, args: ['-d', distro(), '--exec', 'bwrap', ...bwrapArgs(workspace, cwd), '/usr/bin/node', workerWsl] };
    }
    boundWorkspace = null;
    return { cmd: 'wsl.exe', bwrap: false, args: ['-d', distro(), '--exec', '/usr/bin/node', workerWsl] };
  }
  if (IS_LINUX && useBwrap() && commandExists('bwrap')) {
    const workspace = spaceDir(process.env.MICRODOT_AGENT || 'main');
    mkdirSync(workspace, { recursive: true });
    boundWorkspace = workspace;
    return { cmd: 'bwrap', bwrap: true, args: [...bwrapArgs(workspace, process.cwd()), node, worker] };
  }
  boundWorkspace = null;
  return { cmd: node, bwrap: false, args: [worker] };
}

// Normalise a sandbox path for comparison (separators + trailing slash; case
// only matters on Windows).
function normSandboxPath(p) {
  const s = String(p).replace(/\\/g, '/').replace(/\/+$/, '');
  return IS_WIN ? s.toLowerCase() : s;
}

// One-time warning: WSL interop lets sandboxed tools run Windows binaries on the
// host, so the read-only mount is NOT a security boundary.
let warnedInterop = false;
function maybeWarnInterop(interop) {
  if (!interop || warnedInterop) return;
  warnedInterop = true;
  process.stderr.write(
    '[sandbox] note: WSL interop is enabled — sandboxed tools can run Windows programs (cmd.exe/powershell.exe) on the host, which bypasses the read-only mount. The sandbox is NOT a security boundary. See docs/safety.md.\n',
  );
}
// Probe from the HOST (works even under bwrap, whose fresh /proc hides binfmt_misc).
function warnIfWslInterop() {
  if (warnedInterop || !IS_WIN) return;
  try {
    const r = spawnSync('wsl.exe', ['-d', distro(), '--exec', '/bin/sh', '-c', 'test -e /proc/sys/fs/binfmt_misc/WSLInterop'], {
      stdio: 'ignore',
    });
    if (r.status === 0) maybeWarnInterop(true);
  } catch {
    /* ignore */
  }
}

let worker = null;
let ready = null;
let readyResolve = null;
let readyReject = null;
let startTimer = null;
let seq = 0;
let bwrapFailed = false;
const runs = new Map(); // id -> { resolve, reject, log, timer }

function ensureWorker() {
  if (worker) return ready;
  ready = new Promise((res, rej) => {
    readyResolve = () => {
      if (startTimer) {
        clearTimeout(startTimer);
        startTimer = null;
      }
      res();
    };
    readyReject = (err) => {
      if (startTimer) {
        clearTimeout(startTimer);
        startTimer = null;
      }
      rej(err);
    };
  });
  startWorker();
  // Never hang forever if the worker can't start (e.g. no WSL) — reject so the
  // caller can fall back.
  const t = Number(process.env.MICRODOT_SANDBOX_START_TIMEOUT_MS ?? 15000);
  if (Number.isFinite(t) && t > 0) {
    startTimer = setTimeout(() => readyReject?.(new Error(`sandbox worker did not start within ${t}ms`)), t);
  }
  return ready;
}

function startWorker() {
  warnIfWslInterop();
  const { cmd, args, bwrap } = workerCommand();
  const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  worker = child;
  let becameReady = false;
  const onReady = () => {
    becameReady = true;
    readyResolve?.();
  };

  const detach = (reason) => {
    const wasCurrent = worker === child;
    if (wasCurrent) worker = null;
    for (const [id, r] of runs) {
      clearTimeout(r.timer);
      r.reject(new Error(reason));
      runs.delete(id);
    }
    return wasCurrent;
  };
  const retryUnconfined = (label) => {
    if (bwrap && !becameReady && !bwrapFailed) {
      bwrapFailed = true;
      process.stderr.write(`[sandbox] ${label}; falling back to the unconfined worker.\n`);
      startWorker();
      return true;
    }
    return false;
  };

  let buf = '';
  child.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      handleLine(line, onReady);
    }
  });
  child.stderr.on('data', (d) => process.stderr.write(`[sandbox] ${d.toString('utf8')}`));
  child.on('error', (err) => {
    const wasCurrent = detach(`sandbox worker error: ${err.message}`);
    if (!wasCurrent) return;
    if (!retryUnconfined('failed to launch')) readyReject?.(new Error(`sandbox worker error: ${err.message}`));
  });
  child.on('exit', () => {
    const wasCurrent = detach('sandbox worker exited');
    if (!wasCurrent) return;
    if (!retryUnconfined('bubblewrap unavailable') && !becameReady) {
      readyReject?.(new Error('sandbox worker exited'));
    }
  });
}

function handleLine(line, onReady) {
  const i = line.indexOf(SENTINEL);
  if (i < 0) {
    if (line.trim()) process.stdout.write(`${line}\n`);
    return;
  }
  let msg;
  try {
    msg = JSON.parse(line.slice(i + SENTINEL.length));
  } catch {
    return;
  }
  if (msg.type === 'ready') {
    maybeWarnInterop(msg.interop);
    onReady?.();
    return;
  }
  if (msg.type === 'log') {
    runs.get(msg.id)?.log?.(msg.message);
    return;
  }
  if (msg.type === 'host') {
    Promise.resolve()
      .then(() => runs.get(msg.runId)?.bridge?.(msg.spec))
      .then(
        (value) => sendHost({ hid: msg.hid, ok: true, value: value ?? null }),
        (e) => sendHost({ hid: msg.hid, ok: false, error: String(e?.message ?? e) }),
      );
    return;
  }
  if (msg.type === 'result') {
    const r = runs.get(msg.id);
    if (!r) return;
    runs.delete(msg.id);
    clearTimeout(r.timer);
    if (msg.ok) {
      // A tool whose code computed but never `return`ed would otherwise surface
      // as a silent `null` (which reads like "the sandbox is broken").
      if (msg.noReturn) {
        r.log?.('tool ran, but returned no value — add a `return` statement (this is not a sandbox error).');
        r.resolve({ warning: 'tool ran but returned no value — add a `return` statement. The sandbox is fine; the tool code simply did not return anything.' });
      } else {
        r.resolve(msg.value);
      }
    } else {
      r.reject(new Error(msg.error));
    }
  }
}

function sendHost(obj) {
  try {
    worker?.stdin.write(`${JSON.stringify({ type: 'hostResult', ...obj })}\n`);
  } catch {
    /* ignore */
  }
}

export async function runSandboxedTool({ code, args, root, agentId, bridge, log, textLimit, timeoutMs } = {}) {
  // bwrap binds exactly one workspace at worker start. If the active top-level
  // space has changed (e.g. a /project switch), the running worker's bind is
  // stale and the new space would be read-only (EROFS) — restart it so it
  // rebinds to the current space.
  const topSpace = hostToSandboxPath(spaceDir(process.env.MICRODOT_AGENT || 'main'));
  if (boundWorkspace && normSandboxPath(boundWorkspace) !== normSandboxPath(topSpace)) {
    stopSandboxWorker();
  }
  await ensureWorker();
  const id = `r${++seq}`;
  const rootSandbox = hostToSandboxPath(root ?? spaceDir(process.env.MICRODOT_AGENT || 'main'));
  const tl = Number(timeoutMs ?? process.env.MICRODOT_WSL_TIMEOUT_MS ?? 60000);

  return await new Promise((resolve, reject) => {
    const timer =
      Number.isFinite(tl) && tl > 0
        ? setTimeout(() => {
            if (!runs.has(id)) return;
            runs.delete(id);
            stopSandboxWorker(); // kill the runaway process; it restarts on the next call
            reject(new Error('tool timed out'));
          }, tl)
        : null;
    runs.set(id, { resolve, reject, log, timer, bridge });
    worker.stdin.write(`${JSON.stringify({ type: 'run', id, code, args, root: rootSandbox, agentId, textLimit })}\n`);
  });
}

export function stopSandboxWorker() {
  try {
    worker?.kill();
  } catch {
    /* ignore */
  }
  worker = null;
  ready = null;
  readyResolve = null;
  boundWorkspace = null;
}
