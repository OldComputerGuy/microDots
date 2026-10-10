// Windows-side driver for the WSL tool sandbox.
//
// Spawns a persistent worker INSIDE WSL and talks newline-delimited JSON over
// stdio. The worker runs tool code; browser / openPath requests come back here
// and are performed by MiniDot (Playwright / the OS), then answered.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const SENTINEL = '@@MINIDOT@@';
const distro = () => process.env.MINIDOT_WSL_DISTRO || 'Ubuntu-24.04';

export function toWslPath(win) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(win);
  if (!m) return String(win).replace(/\\/g, '/');
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`;
}

export function toWinPath(wsl) {
  const m = /^\/mnt\/([a-z])\/(.*)$/i.exec(String(wsl));
  if (!m) return wsl;
  return `${m[1].toUpperCase()}:\\${m[2].replace(/\//g, '\\')}`;
}

let worker = null;
let ready = null;
let readyResolve = null;
let seq = 0;
let hostHandler = null;
const runs = new Map(); // id -> { resolve, reject, log, timer }

function ensureWorker() {
  if (worker) return ready;
  const workerPath = toWslPath(resolve(process.cwd(), 'src/wsl/worker.mjs'));
  worker = spawn('wsl.exe', ['-d', distro(), '--exec', '/usr/bin/node', workerPath], {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  ready = new Promise((res) => {
    readyResolve = res;
  });

  let buf = '';
  worker.stdout.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      handleLine(line);
    }
  });
  worker.stderr.on('data', (d) => process.stderr.write(`[wsl] ${d.toString('utf8')}`));
  worker.on('exit', () => {
    const wasReady = !!worker;
    worker = null;
    ready = null;
    readyResolve = null;
    for (const [id, r] of runs) {
      clearTimeout(r.timer);
      r.reject(new Error('WSL worker exited'));
      runs.delete(id);
    }
    void wasReady;
  });
  return ready;
}

function handleLine(line) {
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
    readyResolve?.();
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

export async function runWslTool({ code, args, root, agentId, bridge, log, textLimit, timeoutMs } = {}) {
  await ensureWorker();
  hostHandler = bridge;
  const id = `r${++seq}`;
  const rootWsl = toWslPath(root ?? resolve(process.cwd(), 'workspace'));
  const tl = Number(timeoutMs ?? process.env.MINIDOT_WSL_TIMEOUT_MS ?? 60000);

  return await new Promise((resolve, reject) => {
    const timer =
      Number.isFinite(tl) && tl > 0
        ? setTimeout(() => {
            if (!runs.has(id)) return;
            runs.delete(id);
            stopWslWorker(); // kill the runaway process; it restarts on the next call
            reject(new Error('tool timed out'));
          }, tl)
        : null;
    runs.set(id, { resolve, reject, log, timer });
    worker.stdin.write(`${JSON.stringify({ type: 'run', id, code, args, root: rootWsl, agentId, textLimit })}\n`);
  });
}

export function stopWslWorker() {
  try {
    worker?.kill();
  } catch {
    /* ignore */
  }
  worker = null;
  ready = null;
  readyResolve = null;
}
