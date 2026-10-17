// MicroDot WSL tool worker.
//
// Runs INSIDE WSL (Linux) and executes one self-authored tool at a time.
// The OS (WSL2 kernel + this process) is the sandbox boundary; the tool code
// gets a ctx with:
//   - ctx.fs      : a filesystem jailed to one folder (and its sub-folders)
//   - ctx.fetch   : native HTTP(S) from inside WSL
//   - ctx.browser : bridged back to the Windows host (Playwright) over stdio
//   - ctx.openPath: opens a file on the Windows host
//   - ctx.log     : streamed back to the host console
//
// Protocol: newline-delimited JSON on stdin (requests). Responses go to stdout
// prefixed with a sentinel so any stray output from tool code can't corrupt it.
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';

const SENTINEL = '@@MICRODOT@@';
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const pending = new Map();
let hid = 0;

function send(obj) {
  process.stdout.write(SENTINEL + JSON.stringify(obj) + '\n');
}

function hostCall(runId, spec) {
  return new Promise((resolve, reject) => {
    const id = 'h' + ++hid;
    pending.set(id, { resolve, reject });
    send({ type: 'host', hid: id, runId, spec });
  });
}

function jail(root) {
  let rootReal = root;
  try {
    rootReal = fs.realpathSync(root);
  } catch {
    /* may not exist yet */
  }
  const inside = (abs) => {
    const rel = path.relative(rootReal, abs);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  };
  const resolveIn = (p) => {
    const raw = String(p ?? '.');
    // Reject host-absolute path FORMS that Linux would otherwise treat as a
    // relative filename ("C:\x", "C:/x", "\\server\share", "\x"). Without this
    // they silently land inside the space and read as a false "ok".
    if (/^[A-Za-z]:[\\/]/.test(raw) || /^\\\\/.test(raw) || raw.startsWith('\\')) {
      throw new Error(
        `refusing an absolute host path from the sandbox: "${raw}" — your filesystem is jailed to your space; use a path relative to it (to deliver outside, use a read-only reference, or ask the operator to mount it).`,
      );
    }
    if (/[\u0000-\u001f]/.test(raw)) {
      throw new Error(`invalid path (control character): ${JSON.stringify(raw)}`);
    }
    const abs = path.resolve(rootReal, raw);
    if (!inside(abs)) throw new Error(`path escapes the sandbox: ${raw}`);
    let probe = fs.existsSync(abs) ? abs : path.dirname(abs);
    while (!fs.existsSync(probe)) {
      const up = path.dirname(probe);
      if (up === probe) break;
      probe = up;
    }
    let real = probe;
    try {
      real = fs.realpathSync(probe);
    } catch {
      /* ignore */
    }
    if (!inside(real)) throw new Error(`path escapes the sandbox (via link): ${p}`);
    return abs;
  };
  return { root: rootReal, resolveIn };
}

function makeFs(j) {
  const enc = (e) => (e === 'base64' ? 'base64' : e || 'utf8');
  const parent = (abs) => fsp.mkdir(path.dirname(abs), { recursive: true });
  return {
    root: j.root,
    readFile: (p, e) => fsp.readFile(j.resolveIn(p)).then((b) => b.toString(enc(e))),
    readText: (p) => fsp.readFile(j.resolveIn(p), 'utf8'),
    readBase64: (p) => fsp.readFile(j.resolveIn(p)).then((b) => b.toString('base64')),
    writeFile: async (p, d, e) => {
      const abs = j.resolveIn(p);
      await parent(abs);
      await fsp.writeFile(abs, Buffer.from(String(d), e === 'base64' ? 'base64' : 'utf8'));
      return true;
    },
    writeBase64: async (p, d) => {
      const abs = j.resolveIn(p);
      await parent(abs);
      await fsp.writeFile(abs, Buffer.from(String(d), 'base64'));
      return true;
    },
    appendFile: async (p, d, e) => {
      const abs = j.resolveIn(p);
      await parent(abs);
      await fsp.appendFile(abs, Buffer.from(String(d), e === 'base64' ? 'base64' : 'utf8'));
      return true;
    },
    exists: async (p) => {
      try {
        await fsp.access(j.resolveIn(p));
        return true;
      } catch {
        return false;
      }
    },
    list: async (p) => {
      const abs = j.resolveIn(p || '.');
      const items = await fsp.readdir(abs, { withFileTypes: true });
      return Promise.all(
        items.map(async (d) => {
          let size = null;
          try {
            size = (await fsp.stat(path.resolve(abs, d.name))).size;
          } catch {
            /* ignore */
          }
          return { name: d.name, isDir: d.isDirectory(), size };
        }),
      );
    },
    mkdir: async (p) => {
      await fsp.mkdir(j.resolveIn(p), { recursive: true });
      return true;
    },
    remove: async (p) => {
      await fsp.rm(j.resolveIn(p), { recursive: true, force: true });
      return true;
    },
    stat: async (p) => {
      const s = await fsp.stat(j.resolveIn(p));
      return { size: s.size, isDir: s.isDirectory(), isFile: s.isFile(), mtimeMs: s.mtimeMs };
    },
    rename: async (a, b) => {
      const to = j.resolveIn(b);
      await parent(to);
      await fsp.rename(j.resolveIn(a), to);
      return true;
    },
    copy: async (a, b) => {
      const to = j.resolveIn(b);
      await parent(to);
      await fsp.cp(j.resolveIn(a), to, { recursive: true });
      return true;
    },
  };
}

const str = (x) => (typeof x === 'string' ? x : JSON.stringify(x));

async function run(msg) {
  const { id, code, args, root, agentId, textLimit = 8000 } = msg;
  const j = jail(root);
  const stop = (s) => (typeof s === 'string' ? s.slice(0, textLimit) : s);
  const ctx = {
    agentId,
    root: j.root,
    fs: makeFs(j),
    browser: {
      open: (url) => hostCall(id, { op: 'browser_open', url: String(url) }),
      text: () => hostCall(id, { op: 'browser_text' }),
      url: () => hostCall(id, { op: 'browser_url' }),
      screenshot: () => hostCall(id, { op: 'browser_screenshot' }),
      click: (s) => hostCall(id, { op: 'browser_click', selector: String(s) }),
      type: (s, t) => hostCall(id, { op: 'browser_type', selector: String(s), text: String(t) }),
      scroll: (opts = {}) => hostCall(id, { op: 'browser_scroll', direction: opts.direction, amount: opts.amount, selector: opts.selector }),
      close: () => hostCall(id, { op: 'browser_close' }),
    },
    fetch: async (url, opts) => {
      const res = await fetch(String(url), { redirect: 'follow', ...(opts || {}) });
      const text = await res.text();
      return { status: res.status, url: res.url, text: stop(text) };
    },
    openPath: (p) => hostCall(id, { op: 'openPath', path: String(p) }),
    log: (...a) => send({ type: 'log', id, message: a.map(str).join(' ') }),
  };

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction('args', 'ctx', code);
    const value = await fn(args ?? {}, ctx);
    send({ type: 'result', id, ok: true, value: value === undefined ? null : value, noReturn: value === undefined });
  } catch (e) {
    send({ type: 'result', id, ok: false, error: String(e?.message ?? e) });
  }
}

// Any plain console output from tool code must not corrupt the protocol.
console.log = (...a) => send({ type: 'log', message: a.map(str).join(' ') });
console.error = console.log;

rl.on('line', (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try {
    msg = JSON.parse(t);
  } catch {
    return;
  }
  if (msg.type === 'hostResult') {
    const p = pending.get(msg.hid);
    if (!p) return;
    pending.delete(msg.hid);
    if (msg.ok) p.resolve(msg.value);
    else p.reject(new Error(msg.error));
  } else if (msg.type === 'run') {
    run(msg);
  }
});

// Report whether Windows interop is reachable (WSL) — the host warns if so.
function interopEnabled() {
  try {
    return fs.existsSync('/proc/sys/fs/binfmt_misc/WSLInterop');
  } catch {
    return false;
  }
}
send({ type: 'ready', interop: interopEnabled() });
