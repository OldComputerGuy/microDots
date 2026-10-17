// Read-only file references.
//
// A reference is just a path the user explicitly handed to the agent ("/ref
// <path>", or a dropped file). The registry is process-global so sub-agents
// inherit the same list. The CLI persists the host paths in the saved chat and
// reloads them on resume. Nothing here reads or writes the file contents.
import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostToSandboxPath, sandboxToHostPath } from './tool-sandbox.mjs';

let refs = []; // [{ host, sandbox, size }]

const norm = (s) => String(s).replace(/\\/g, '/').replace(/\/+$/, '');
const samePath = (a, b) => {
  const x = norm(a);
  const y = norm(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};
export const baseName = (p) => String(p).replace(/[\\/]+$/, '').split(/[\\/]/).pop();

export function addReference(p) {
  const key = String(p ?? '').trim();
  if (!key) throw new Error('a path is required');
  const host = resolve(process.cwd(), key);
  let st;
  try {
    st = statSync(host);
  } catch {
    throw new Error(`not found: ${key}`);
  }
  if (!st.isFile()) throw new Error(`not a file: ${key}`);
  const existing = refs.find((r) => samePath(r.host, host));
  if (existing) return existing;
  const entry = { host, sandbox: hostToSandboxPath(host), size: st.size };
  refs.push(entry);
  return entry;
}

export function removeReference(p) {
  const key = String(p ?? '').trim();
  if (!key) return 0;
  if (key === 'all' || key === '*') {
    const n = refs.length;
    refs = [];
    return n;
  }
  const before = refs.length;
  refs = refs.filter((r) => !(samePath(r.host, key) || samePath(r.sandbox, key) || baseName(r.host) === key));
  return before - refs.length;
}

export function setReferences(paths = []) {
  refs = [];
  for (const p of paths || []) {
    try {
      addReference(p);
    } catch {
      /* drop references whose file no longer exists */
    }
  }
  return listReferences();
}

export function listReferences() {
  return refs.map((r) => ({ path: r.host, sandbox: r.sandbox, bytes: r.size }));
}

export function referencePaths() {
  return refs.map((r) => r.host);
}

// Resolve a tool argument (host path, sandbox path, relative path, or unique
// basename) to a registered reference. Returns null if it isn't registered.
export function findReference(p) {
  const key = String(p ?? '').trim();
  if (!key) return null;
  let hit = refs.find((r) => samePath(r.host, key) || samePath(r.sandbox, key));
  if (hit) return hit;
  const abs = resolve(process.cwd(), key);
  hit = refs.find((r) => samePath(r.host, abs) || samePath(r.sandbox, abs));
  if (hit) return hit;
  hit = refs.find((r) => samePath(r.host, sandboxToHostPath(key)));
  if (hit) return hit;
  const byBase = refs.filter((r) => baseName(r.host) === baseName(key));
  if (byBase.length === 1) return byBase[0];
  return null;
}

// A short block for the system prompt (paths only — no sizes/line counts).
export function describeReferences() {
  if (!refs.length) return '';
  return refs.map((r) => `- ${r.host}  (sandbox: ${r.sandbox})`).join('\n');
}
