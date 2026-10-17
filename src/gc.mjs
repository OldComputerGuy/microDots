// Garbage collection for AGENT-AUTHORED TOOLS only.
//
// The agent reviews its own tools occasionally ("is this temporary? an old
// version?") and moves doubtful ones to a reversible trash can. This module
// provides the inventory + the safe actions; the model makes the judgement.
//
// Nothing here touches built-ins, the shipped engine tools (tools-custom/),
// skills, chats, notes or any non-tool file. Nothing is ever deleted: tools are
// parked (leading "_") or moved to <data>/.microdot/trash/tools.
import { readdirSync, statSync, renameSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { dataDir, projectsRoot, projectDir } from './home.mjs';

const trashToolsDir = () => resolve(dataDir(), 'trash', 'tools');
const trashManifest = () => resolve(dataDir(), 'trash', 'manifest.json');

function readManifest() {
  try {
    const j = JSON.parse(readFileSync(trashManifest(), 'utf8'));
    return Array.isArray(j) ? j : [];
  } catch {
    return [];
  }
}
function writeManifest(list) {
  mkdirSync(resolve(dataDir(), 'trash'), { recursive: true });
  writeFileSync(trashManifest(), JSON.stringify(list, null, 2));
}

// Agent-authored tool dirs: the root layer and every named project. The shipped
// engine tools (tools-custom/) are deliberately excluded.
function toolDirs() {
  const dirs = [];
  const seen = new Set();
  const add = (project, dir) => {
    const r = resolve(dir);
    const key = process.platform === 'win32' ? r.toLowerCase() : r;
    if (seen.has(key)) return;
    seen.add(key);
    dirs.push({ project, dir: r });
  };
  // The data-root layer (what /tools calls "root") ...
  add('(root)', resolve(dataDir(), 'tools'));
  // ... and the actual write layer (root when no project, else the project).
  const cur = (process.env.MICRODOT_PROJECT || '').trim();
  add(cur || '(root)', resolve(projectDir(), 'tools'));
  try {
    for (const e of readdirSync(projectsRoot(), { withFileTypes: true })) {
      if (e.isDirectory() && !e.name.startsWith('.')) {
        add(e.name, resolve(projectsRoot(), e.name, 'tools'));
      }
    }
  } catch {
    /* no projects */
  }
  return dirs;
}

function metaOf(text) {
  const m = text.match(/\/\/ meta:\s*(\{.*\})/);
  if (!m) return {};
  try {
    return JSON.parse(m[1]);
  } catch {
    return {};
  }
}
function descriptionOf(text) {
  const d = text.match(/"description"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (!d) return '';
  try {
    return JSON.parse(`"${d[1]}"`);
  } catch {
    return '';
  }
}

export async function inventory() {
  const out = [];
  for (const { project, dir } of toolDirs()) {
    let files = [];
    try {
      files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.mjs'));
    } catch {
      continue;
    }
    for (const f of files) {
      const file = join(dir, f);
      let st;
      try {
        st = statSync(file);
      } catch {
        continue;
      }
      const name = f.replace(/\.mjs$/i, '');
      let description = '';
      let status = '';
      try {
        const text = readFileSync(file, 'utf8');
        description = descriptionOf(text);
        status = metaOf(text).status || '';
      } catch {
        /* unreadable → still listed (a trash candidate) */
      }
      out.push({
        name,
        project,
        file,
        parked: name.startsWith('_'),
        status,
        description,
        bytes: st.size,
        ageDays: Math.floor((Date.now() - st.mtimeMs) / 86400000),
      });
    }
  }
  return out;
}

function findTool(inv, name) {
  const hit = inv.find((t) => t.name === name);
  if (!hit) throw new Error(`no agent-authored tool named "${name}"`);
  return hit;
}

// Park = disable without deleting: rename "<name>.mjs" -> "_<name>.mjs".
export async function parkTool(name) {
  const inv = await inventory();
  const t = findTool(inv, name);
  if (t.parked) return { parked: t.name, note: 'already parked' };
  const dir = resolve(t.file, '..');
  const next = join(dir, `_${t.name}.mjs`);
  if (existsSync(next)) throw new Error(`"${next}" already exists`);
  renameSync(t.file, next);
  return { parked: `_${t.name}`, file: next };
}

// Trash = move the tool file to the shared trash (reversible).
export async function trashTool(name, reason = '') {
  const inv = await inventory();
  const t = findTool(inv, name);
  const id = `${Date.now()}-${t.name}`;
  mkdirSync(trashToolsDir(), { recursive: true });
  const dest = join(trashToolsDir(), `${id}.mjs`);
  renameSync(t.file, dest);
  const manifest = readManifest();
  manifest.push({
    id,
    name: t.name,
    project: t.project,
    original: t.file,
    trashed: dest,
    reason: String(reason || '').trim(),
    at: new Date().toISOString(),
  });
  writeManifest(manifest);
  return { trashed: t.name, id, original: t.file, reason };
}

export function listTrash() {
  return readManifest();
}

export function restoreTrash(idOrName) {
  const manifest = readManifest();
  const key = String(idOrName || '').trim();
  const i = manifest.findIndex((e) => e.id === key || e.name === key);
  if (i < 0) throw new Error(`no trashed tool matching "${key}"`);
  const e = manifest[i];
  if (existsSync(e.original)) throw new Error(`"${e.original}" already exists — remove it first`);
  if (!existsSync(e.trashed)) throw new Error(`trashed file missing: ${e.trashed}`);
  mkdirSync(resolve(e.original, '..'), { recursive: true });
  renameSync(e.trashed, e.original);
  manifest.splice(i, 1);
  writeManifest(manifest);
  return { restored: e.name, to: e.original };
}

export function emptyTrash() {
  const manifest = readManifest();
  try {
    rmSync(trashToolsDir(), { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  writeManifest([]);
  return { emptied: manifest.length };
}
