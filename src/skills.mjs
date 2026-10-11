// Reusable "skills": named markdown recipes the agent can create and follow.
// Layered: engine skills (<install>/skills) are shared; project skills
// (<project>/.microdot/skills) override them. New ones are written to the project.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { layerDirs, writeDir } from './home.mjs';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const dirs = () => layerDirs('MICRODOT_SKILLS_DIR', 'skills', 'skills');

export const skillsDir = () => writeDir('MICRODOT_SKILLS_DIR', 'skills', 'skills');
const skillFile = (dir, name) => join(dir, `${name}.md`);

// Merged across layers (project overrides engine by name).
export function listSkills() {
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

function findSkillFile(name) {
  for (const dir of [...dirs()].reverse()) {
    const file = skillFile(dir, name);
    if (existsSync(file)) return file;
  }
  return null;
}

export function readSkill(name) {
  const file = findSkillFile(name);
  if (!file) throw new Error(`no skill named "${name}"`);
  return readFileSync(file, 'utf8');
}

export function saveSkill({ name, description, instructions }, dir = skillsDir()) {
  if (!NAME_RE.test(String(name ?? ''))) {
    throw new Error('invalid skill name: use letters, digits, hyphen or underscore');
  }
  mkdirSync(dir, { recursive: true });
  const file = skillFile(dir, name);
  writeFileSync(file, `# ${description || name}\n\n${instructions || ''}\n`);
  return file;
}

export function deleteSkill(name) {
  let removed = null;
  for (const dir of dirs()) {
    const file = skillFile(dir, name);
    if (existsSync(file)) {
      rmSync(file, { force: true });
      removed = file;
    }
  }
  return removed;
}
