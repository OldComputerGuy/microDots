// Path layers:
//   engine  = where MicroDot's code + shipped defaults live (this install dir)
//   project = the folder you launched from  ->  <launchDir>/.microdot
//
// Engine holds the shared Chromium profile and shipped worker-types/skills/tools.
// Project holds chats, spaces, and any project-specific tools/skills/worker-types.
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url)); // .../<install>/src

export const engineDir = () => resolve(process.env.MICRODOT_HOME || resolve(here, '..'));
export const projectDir = () => resolve(process.env.MICRODOT_LAUNCH_DIR || process.cwd(), '.microdot');

// Create the project layer and drop a self-ignoring .gitignore so it never
// lands in a repo.
export function ensureProject() {
  const dir = projectDir();
  mkdirSync(dir, { recursive: true });
  const gi = resolve(dir, '.gitignore');
  if (!existsSync(gi)) writeFileSync(gi, '*\n');
  return dir;
}

// An explicit env override (single dir) wins; otherwise the engine layer first,
// then the project layer (so project items override engine ones by name).
export function layerDirs(envOverride, engineName, projectName) {
  const override = (process.env[envOverride] || '').trim();
  if (override) return [resolve(process.cwd(), override)];
  return [resolve(engineDir(), engineName), resolve(projectDir(), projectName)];
}

// Where *new* items are written (the project layer, or the override).
export function writeDir(envOverride, engineName, projectName) {
  const dirs = layerDirs(envOverride, engineName, projectName);
  return dirs[dirs.length - 1];
}
