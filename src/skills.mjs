// Reusable "skills": named markdown recipes the agent can create and follow.
// Stored as ./skills/<name>.md where the first non-empty line is the summary.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

export const skillsDir = () => resolve(process.cwd(), process.env.MINIDOT_SKILLS_DIR ?? 'skills');
const skillFile = (dir, name) => join(dir, `${name}.md`);

export function listSkills(dir = skillsDir()) {
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

export function readSkill(name, dir = skillsDir()) {
  return readFileSync(skillFile(dir, name), 'utf8');
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

export function deleteSkill(name, dir = skillsDir()) {
  const file = skillFile(dir, name);
  rmSync(file, { force: true });
  return file;
}
