// Spaces: each worker gets its own folder for its mission and all its files.
//
//   spaces/<worker_name>/
//     mission.md      <- the Dot's standing objective (injected into the prompt)
//     shots/          <- screenshots
//     <other files>   <- notes, documents, downloads the worker produces
//
// The space is also the sandbox root, so tool file writes land here (enforced).
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { projectDir } from './home.mjs';

export function spaceName(agentId = 'main') {
  return (process.env.MICRODOT_SPACE || agentId || 'main').trim() || 'main';
}

// Spaces live in the project layer: <project>/.microdot/spaces/<worker>.
// MICRODOT_SANDBOX_DIR is an explicit override.
export function spaceDir(agentId = 'main') {
  const override = (process.env.MICRODOT_SANDBOX_DIR || '').trim();
  if (override) return resolve(process.cwd(), override);
  return resolve(projectDir(), 'spaces', spaceName(agentId));
}

export function shotsDir(agentId = 'main') {
  return resolve(spaceDir(agentId), 'shots');
}

export function missionPath(agentId = 'main') {
  return resolve(spaceDir(agentId), 'mission.md');
}

export function ensureSpace(agentId = 'main') {
  const dir = spaceDir(agentId);
  mkdirSync(shotsDir(agentId), { recursive: true });
  const file = missionPath(agentId);
  if (!existsSync(file)) {
    const mission = (process.env.MICRODOT_MISSION || '').trim();
    const body = mission || `# Mission\n\nNo mission set yet for space "${spaceName(agentId)}".\n`;
    writeFileSync(file, body.endsWith('\n') ? body : `${body}\n`);
  }
  return dir;
}

export function readMission(agentId = 'main') {
  try {
    return readFileSync(missionPath(agentId), 'utf8');
  } catch {
    return '';
  }
}

export function writeMission(agentId, text) {
  mkdirSync(spaceDir(agentId), { recursive: true });
  writeFileSync(missionPath(agentId), text.endsWith('\n') ? text : `${text}\n`);
  return missionPath(agentId);
}

// The chosen worker type is recorded in the space so it persists across sessions.
export function typePath(agentId = 'main') {
  return resolve(spaceDir(agentId), 'worker_type');
}

export function getSpaceType(agentId = 'main') {
  try {
    return readFileSync(typePath(agentId), 'utf8').trim();
  } catch {
    return '';
  }
}

export function setSpaceType(agentId, type) {
  mkdirSync(spaceDir(agentId), { recursive: true });
  writeFileSync(typePath(agentId), `${type}\n`);
  return typePath(agentId);
}
