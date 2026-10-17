// .workers: standing, project-scoped agents the main agent spawns and consults.
//
// A .worker lives inside a project and shares its layer (tools / skills /
// worker-types), but keeps its own sub-area:
//
//   <project>/.microdot/workers/
//     .doc_search/
//       context.json      { name, type, mission, messages, createdAt, updatedAt }
//       mission.md
//       space/            the .worker's files (its ctx.fs root)
//
// Storage only — running a .worker (and its browser tab) is wired up by the host
// (the CLI), which owns the model, browser and sandbox.
import { readdirSync, mkdirSync, existsSync, readFileSync, writeFileSync, renameSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { projectDir } from './home.mjs';

const NAME_RE = /^\.[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function validWorkerName(name) {
  const n = String(name || '').trim();
  if (!NAME_RE.test(n)) {
    throw new Error(`invalid .worker name "${name}" — start with a dot then a letter/digit (e.g. ".doc_search")`);
  }
  return n;
}

export const workersRoot = () => resolve(projectDir(), 'workers');
export const archiveRoot = () => resolve(projectDir(), 'workers-archive');
export const workerDir = (name) => resolve(workersRoot(), validWorkerName(name));
export const workerSpace = (name) => resolve(workerDir(name), 'space');
const contextFile = (name) => resolve(workerDir(name), 'context.json');
const missionFile = (name) => resolve(workerDir(name), 'mission.md');

export const maxWorkers = () => Number(process.env.MICRODOT_MAX_WORKERS ?? 12) || 12;

function dotDirs(root) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('.'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export function listWorkerRecords() {
  const out = [];
  for (const name of dotDirs(workersRoot())) {
    try {
      const j = JSON.parse(readFileSync(contextFile(name), 'utf8'));
      out.push({
        name,
        type: j.type || 'default',
        mission: (j.mission || '').split('\n')[0].slice(0, 80),
        messages: (j.messages || []).length,
        updatedAt: j.updatedAt || 0,
      });
    } catch {
      /* skip unreadable */
    }
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function countWorkers() {
  return dotDirs(workersRoot()).length;
}

export function readWorker(name) {
  const n = validWorkerName(name);
  try {
    const j = JSON.parse(readFileSync(contextFile(n), 'utf8'));
    return { name: n, type: j.type || 'default', mission: j.mission || '', messages: Array.isArray(j.messages) ? j.messages : [], createdAt: j.createdAt || Date.now(), updatedAt: j.updatedAt || 0 };
  } catch {
    throw new Error(`no .worker named "${n}"`);
  }
}

export function writeWorker(state) {
  const n = validWorkerName(state.name);
  mkdirSync(workerDir(n), { recursive: true });
  const record = { name: n, type: state.type || 'default', mission: state.mission || '', messages: state.messages || [], createdAt: state.createdAt || Date.now(), updatedAt: Date.now() };
  writeFileSync(contextFile(n), JSON.stringify(record, null, 2));
  return record;
}

export function spawnWorker({ name, type = 'default', mission = '' } = {}) {
  const n = validWorkerName(name);
  if (existsSync(workerDir(n))) throw new Error(`.worker "${n}" already exists`);
  if (countWorkers() >= maxWorkers()) throw new Error(`.worker limit reached (MICRODOT_MAX_WORKERS=${maxWorkers()}); retire one first`);
  mkdirSync(workerSpace(n), { recursive: true });
  const text = String(mission || '').trim();
  writeFileSync(missionFile(n), text ? (text.endsWith('\n') ? text : `${text}\n`) : `# Mission\n\nNo mission set yet for ${n}.\n`);
  const record = writeWorker({ name: n, type, mission: text, messages: [] });
  return record;
}

// Retirement is archival (reversible) — move the whole .worker out of the way.
export function retireWorker(name) {
  const n = validWorkerName(name);
  if (!existsSync(workerDir(n))) throw new Error(`no .worker named "${n}"`);
  mkdirSync(archiveRoot(), { recursive: true });
  const dest = join(archiveRoot(), `${Date.now()}-${n}`);
  renameSync(workerDir(n), dest);
  return { retired: n, archived: dest };
}
