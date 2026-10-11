// Browser tab leases + self-cleanup.
//
// Each agent registers a lease for its tab (in the engine layer, since the
// Chromium is shared across projects). On start we sweep orphaned tabs (no live
// owner); on exit we release our lease and, if we were the last agent, stop the
// shared Chromium.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { engineDir } from './home.mjs';

const cdpUrl = () => process.env.MICRODOT_CDP_URL ?? 'http://127.0.0.1:9222';
const tabsDir = () => resolve(engineDir(), '.chromium-tabs');
const pidFile = () => resolve(engineDir(), '.chromium.pid');

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

export function recordChromiumPid(pid) {
  try {
    writeFileSync(pidFile(), String(pid));
  } catch {
    /* ignore */
  }
}

export function registerTab(targetId, meta = {}) {
  try {
    mkdirSync(tabsDir(), { recursive: true });
    writeFileSync(resolve(tabsDir(), `${targetId}.json`), JSON.stringify({ pid: process.pid, at: Date.now(), ...meta }));
  } catch {
    /* ignore */
  }
}

export function unregisterTab(targetId) {
  try {
    rmSync(resolve(tabsDir(), `${targetId}.json`), { force: true });
  } catch {
    /* ignore */
  }
}

function listLeases() {
  let files = [];
  try {
    files = readdirSync(tabsDir()).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  return files
    .map((f) => {
      try {
        return { id: f.replace(/\.json$/, ''), ...JSON.parse(readFileSync(resolve(tabsDir(), f), 'utf8')) };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function cdpTargets() {
  try {
    const res = await fetch(`${cdpUrl()}/json/list`, { signal: AbortSignal.timeout(2000) });
    return await res.json();
  } catch {
    return [];
  }
}

// Close any page tab that isn't owned by a live agent. Returns how many closed.
export async function sweepOrphanTabs() {
  const targets = await cdpTargets();
  if (!targets.length) return 0;
  const leases = new Map(listLeases().map((l) => [l.id, l]));
  let closed = 0;
  for (const t of targets) {
    if (t.type !== 'page') continue;
    const lease = leases.get(t.id);
    if (lease && alive(lease.pid)) continue; // owned by a live agent
    try {
      await fetch(`${cdpUrl()}/json/close/${t.id}`, { signal: AbortSignal.timeout(2000) });
    } catch {
      /* ignore */
    }
    unregisterTab(t.id);
    closed++;
  }
  return closed;
}

// If no other live agent holds a lease, stop the shared Chromium.
export async function stopChromiumIfIdle() {
  if (listLeases().some((l) => alive(l.pid))) return false;
  try {
    if (existsSync(pidFile())) {
      const pid = Number(readFileSync(pidFile(), 'utf8').trim());
      if (Number.isFinite(pid)) {
        try {
          process.kill(pid);
        } catch {
          /* already gone */
        }
      }
    }
  } finally {
    try {
      rmSync(pidFile(), { force: true });
    } catch {
      /* ignore */
    }
  }
  return true;
}

// The CDP target id of a Playwright page (needed to lease/sweep it).
export async function targetIdOf(page) {
  const session = await page.context().newCDPSession(page);
  const info = await session.send('Target.getTargetInfo');
  await session.detach().catch(() => {});
  return info.targetInfo.targetId;
}
