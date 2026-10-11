// Worker types: named markdown files describing how a worker behaves.
// Layered: engine types (<install>/worker-types, the shipped defaults) are
// shared; project types (<project>/.microdot/worker-types) override. New ones
// are written to the project layer.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { layerDirs, writeDir } from './home.mjs';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const dirs = () => layerDirs('MICRODOT_WORKER_TYPES_DIR', 'worker-types', 'worker-types');

export const workerTypesDir = () => writeDir('MICRODOT_WORKER_TYPES_DIR', 'worker-types', 'worker-types');
const typeFile = (dir, name) => join(dir, `${name}.md`);

export function listWorkerTypes() {
  const out = new Map();
  for (const dir of dirs()) {
    let files = [];
    try {
      files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'));
    } catch {
      continue;
    }
    for (const f of files) {
      const name = f.replace(/\.md$/i, '');
      let first = '';
      try {
        first = readFileSync(join(dir, f), 'utf8').split('\n').find((l) => l.trim()) || '';
      } catch {
        /* ignore */
      }
      out.set(name, { name, description: first.replace(/^#+\s*/, '').trim(), file: join(dir, f) });
    }
  }
  return [...out.values()];
}

function findTypeFile(name) {
  for (const dir of [...dirs()].reverse()) {
    const file = typeFile(dir, name);
    if (existsSync(file)) return file;
  }
  return null;
}

export function readWorkerType(name) {
  const file = findTypeFile(name);
  return file ? readFileSync(file, 'utf8') : '';
}

export function saveWorkerType({ name, description, content }, dir = workerTypesDir()) {
  if (!NAME_RE.test(String(name ?? ''))) {
    throw new Error('invalid worker type name: use letters, digits, hyphen or underscore');
  }
  mkdirSync(dir, { recursive: true });
  const file = typeFile(dir, name);
  writeFileSync(file, `# ${description || name}\n\n${content || ''}\n`);
  return file;
}

export function deleteWorkerType(name) {
  let removed = null;
  for (const dir of dirs()) {
    const file = typeFile(dir, name);
    if (existsSync(file)) {
      rmSync(file, { force: true });
      removed = file;
    }
  }
  return removed;
}
