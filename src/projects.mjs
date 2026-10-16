// Named projects: a project is a logical workspace (chats, spaces, mission,
// notes, project-specific tools) identified by NAME — not a folder you navigate.
// The active project lives in the MICRODOT_PROJECT env var (set at runtime via
// /project); MicroDot does NOT auto-load a project at startup.
import { readdirSync, mkdirSync, rmSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectsRoot } from './home.mjs';

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const projectPath = (name) => resolve(projectsRoot(), name);

export function validProjectName(name) {
  const n = String(name || '').trim();
  if (!NAME_RE.test(n) || n === '..' || n === '.') {
    throw new Error(`invalid project name "${name}" — use letters, digits, dot, dash or underscore (max 64)`);
  }
  return n;
}

export function listProjects() {
  let entries = [];
  try {
    entries = readdirSync(projectsRoot(), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((d) => d.isDirectory() && !d.name.startsWith('.'))
    .map((d) => {
      let updatedAt = 0;
      let chats = 0;
      try {
        updatedAt = statSync(projectPath(d.name)).mtimeMs;
      } catch {
        /* ignore */
      }
      try {
        chats = readdirSync(resolve(projectPath(d.name), 'chats')).filter((f) => f.endsWith('.json')).length;
      } catch {
        /* ignore */
      }
      return { name: d.name, updatedAt, chats };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export const existsProject = (name) => {
  const n = String(name || '').trim();
  if (!n || !NAME_RE.test(n)) return false;
  try {
    return statSync(projectPath(n)).isDirectory();
  } catch {
    return false;
  }
};

export function createProject(name) {
  const n = validProjectName(name);
  const dir = projectPath(n);
  mkdirSync(dir, { recursive: true });
  const gi = resolve(dir, '.gitignore');
  if (!existsSync(gi)) writeFileSync(gi, '*\n');
  return dir;
}

export function deleteProject(name) {
  const n = validProjectName(name);
  if (getCurrentProject() === n) throw new Error(`"${n}" is the current project — switch away before deleting it`);
  rmSync(projectPath(n), { recursive: true, force: true });
  return projectPath(n);
}

// The current project is just the MICRODOT_PROJECT env var (set via /project).
export function getCurrentProject() {
  return (process.env.MICRODOT_PROJECT || '').trim() || null;
}

export function setCurrentProject(name) {
  const n = validProjectName(name);
  process.env.MICRODOT_PROJECT = n;
  return n;
}

export function clearCurrentProject() {
  // Remove a legacy .current pointer if one lingers, then drop the env var.
  try {
    rmSync(resolve(projectsRoot(), '.current'), { force: true });
  } catch {
    /* ignore */
  }
  delete process.env.MICRODOT_PROJECT;
}
