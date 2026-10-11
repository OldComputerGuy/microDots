// Worker types: named markdown files describing how a worker behaves.
// They can be handwritten (drop a file in ./worker-types/) or created on the fly
// (save_worker_type). A worker is created with a type; the markdown is injected
// into its system prompt.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const workerTypesDir = () => resolve(process.cwd(), process.env.MICRODOT_WORKER_TYPES_DIR ?? 'worker-types');
const typeFile = (dir, name) => join(dir, `${name}.md`);

export function listWorkerTypes(dir = workerTypesDir()) {
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.md'));
  } catch {
    return [];
  }
  return files.map((f) => {
    const name = f.replace(/\.md$/i, '');
    let first = '';
    try {
      first = readFileSync(join(dir, f), 'utf8').split('\n').find((l) => l.trim()) || '';
    } catch {
      /* ignore */
    }
    return { name, description: first.replace(/^#+\s*/, '').trim(), file: join(dir, f) };
  });
}

export function readWorkerType(name, dir = workerTypesDir()) {
  try {
    return readFileSync(typeFile(dir, name), 'utf8');
  } catch {
    return '';
  }
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

export function deleteWorkerType(name, dir = workerTypesDir()) {
  const file = typeFile(dir, name);
  rmSync(file, { force: true });
  return file;
}
