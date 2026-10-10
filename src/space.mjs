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

export function spaceName(agentId = 'main') {
  return (process.env.MINIDOT_SPACE || agentId || 'main').trim() || 'main';
}

// MINIDOT_SANDBOX_DIR is an explicit override; otherwise spaces/<worker>.
export function spaceDir(agentId = 'main') {
  const override = (process.env.MINIDOT_SANDBOX_DIR || '').trim();
  if (override) return resolve(process.cwd(), override);
  return resolve(process.cwd(), 'spaces', spaceName(agentId));
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
    const mission = (process.env.MINIDOT_MISSION || '').trim();
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
