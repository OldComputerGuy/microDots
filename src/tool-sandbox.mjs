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

const SENTINEL = '@@MINIDOT@@';
const IS_WIN = process.platform === 'win32';
const IS_LINUX = process.platform === 'linux';
const distro = () => process.env.MINIDOT_WSL_DISTRO || 'Ubuntu-24.04';
const workerPath = () => resolve(process.cwd(), 'src/sandbox/worker.mjs');

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

// Back-compat aliases.
export const toWslPath = hostToSandboxPath;
export const toWinPath = sandboxToHostPath;

function commandExists(cmd) {
  try {
    return spawnSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' }).status === 0;
  } catch {
    return false;
  }
}

function useBwrap() {
  return ['1', 'true'].includes(String(process.env.MINIDOT_SANDBOX_BWRAP ?? '').toLowerCase()) && !bwrapFailed;
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

function workerCommand() {
  const worker = workerPath();
  const node = process.env.MINIDOT_NODE || 'node';
  if (IS_WIN) {
    const workerWsl = hostToSandboxPath(worker);
    if (useBwrap()) {
      const space = spaceDir(process.env.MINIDOT_AGENT || 'main');
      mkdirSync(space, { recursive: true });
      const workspace = hostToSandboxPath(space);
      const cwd = hostToSandboxPath(process.cwd());
      return { cmd: 'wsl.exe', bwrap: true, args: ['-d', distro(), '--exec', 'bwrap', ...bwrapArgs(workspace, cwd), '/usr/bin/node', workerWsl] };
    }
    return { cmd: 'wsl.exe', bwrap: false, args: ['-d', distro(), '--exec', '/usr/bin/node', workerWsl] };
  }
  if (IS_LINUX && useBwrap() && commandExists('bwrap')) {
    const workspace = spaceDir(process.env.MINIDOT_AGENT || 'main');
    mkdirSync(workspace, { recursive: true });
    return { cmd: 'bwrap', bwrap: true, args: [...bwrapArgs(workspace, process.cwd()), node, worker] };
  }
  return { cmd: node, bwrap: false, args: [worker] };
}

let worker = null;
let ready = null;
let readyResolve = null;
let seq = 0;
let hostHandler = null;
let bwrapFailed = false;
const runs = new Map(); // id -> { resolve, reject, log, timer }

function ensureWorker() {
  if (worker) return ready;
  ready = new Promise((res) => {
    readyResolve = res;
  });
  startWorker();
  return ready;
}

function startWorker() {
  const { cmd, args, bwrap } = workerCommand();
  const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  worker = child;
  let becameReady = false;
  const onReady = () => {
    becameReady = true;
    readyResolve?.();
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
  child.on('exit', () => {
    const wasCurrent = worker === child;
    if (wasCurrent) {
      worker = null;
    }
    for (const [id, r] of runs) {
      clearTimeout(r.timer);
      r.reject(new Error('sandbox worker exited'));
      runs.delete(id);
    }
    // If bubblewrap couldn't start the worker, silently fall back to an
    // unconfined worker so a missing/blocked `bwrap` never hard-breaks calls.
    if (wasCurrent && bwrap && !becameReady && !bwrapFailed) {
      bwrapFailed = true;
      process.stderr.write(
        '[sandbox] bubblewrap unavailable; falling back to the unconfined worker ' +
          '(install it with `wsl -- sudo apt-get install -y bubblewrap`, or set MINIDOT_SANDBOX_BWRAP=false).\n',
      );
      startWorker(); // readyResolve still points at the original promise
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
    onReady?.();
    return;
  }
  if (msg.type === 'log') {
    runs.get(msg.id)?.log?.(msg.message);
    return;
  }
  if (msg.type === 'host') {
    Promise.resolve()
      .then(() => hostHandler?.(msg.spec))
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
    if (msg.ok) r.resolve(msg.value);
    else r.reject(new Error(msg.error));
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
  await ensureWorker();
  hostHandler = bridge;
  const id = `r${++seq}`;
  const rootSandbox = hostToSandboxPath(root ?? spaceDir(process.env.MINIDOT_AGENT || 'main'));
  const tl = Number(timeoutMs ?? process.env.MINIDOT_WSL_TIMEOUT_MS ?? 60000);

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
    runs.set(id, { resolve, reject, log, timer });
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
}

// Back-compat aliases.
export const runWslTool = runSandboxedTool;
export const stopWslWorker = stopSandboxWorker;
