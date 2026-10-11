// Shared Chromium over CDP: exactly ONE browser process for everything.
// createBrowserHost() never launches a second browser — it connects to the one
// shared Chromium and opens this agent's tab. So: 1 Chromium · N CDP client
// connections ("hosts") · 1 tab per agent.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { engineDir } from './home.mjs';

const cdpUrl = () => process.env.MICRODOT_CDP_URL ?? 'http://127.0.0.1:9222';

// Large viewport by default so screenshots (and what the model sees) are legible.
function envViewport() {
  const m = /^(\d+)\s*x\s*(\d+)$/.exec((process.env.MICRODOT_VIEWPORT ?? '').trim());
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 1600, height: 1000 };
}
const envScale = () => {
  const n = Number(process.env.MICRODOT_SHOT_SCALE);
  return Number.isFinite(n) && n >= 1 ? n : 1;
};

async function cdpReady(url) {
  try {
    const r = await fetch(`${url}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

async function ensureSharedChromium(headless) {
  const url = cdpUrl();
  if (await cdpReady(url)) return;
  const exe = chromium.executablePath();
  const userDir = resolve(engineDir(), '.chromium-profile');
  mkdirSync(userDir, { recursive: true });
  const port = new URL(url).port || '9222';
  const vp = envViewport();
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDir}`,
    `--window-size=${vp.width},${vp.height}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
  ];
  if (headless) args.push('--headless=new');
  // Linux VPS: Chromium refuses to sandbox as root; and allow extra args.
  if (process.platform === 'linux' && typeof process.getuid === 'function' && process.getuid() === 0) {
    args.push('--no-sandbox');
  }
  if (process.env.MICRODOT_CHROMIUM_ARGS) {
    args.push(...process.env.MICRODOT_CHROMIUM_ARGS.split(/\s+/).filter(Boolean));
  }
  args.push('about:blank');
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
  child.unref();
  for (let i = 0; i < 60; i++) {
    if (await cdpReady(url)) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('Could not start the shared Chromium (CDP not reachable).');
}

export async function createBrowserHost({ headless = true, isolate = false } = {}) {
  await ensureSharedChromium(headless);
  const browser = await chromium.connectOverCDP(cdpUrl());

  const viewport = envViewport();
  const scale = envScale();
  let context;
  if (isolate) {
    try {
      context = await browser.newContext({ viewport, deviceScaleFactor: scale });
    } catch {
      context = browser.contexts()[0] ?? (await browser.newContext());
    }
  } else {
    context = browser.contexts()[0] ?? (await browser.newContext());
  }

  let page = null;
  async function getPage() {
    if (!page || page.isClosed()) {
      page = await context.newPage();
      // For the shared default context the page inherits the window size;
      // set an explicit large viewport so captures are consistent and legible.
      await page.setViewportSize(viewport).catch(() => {});
    }
    return page;
  }
  async function closeTab() {
    if (page) {
      await page.close().catch(() => {});
      page = null;
    }
  }
  // Disconnects this agent only; the shared Chromium keeps running.
  async function close() {
    try {
      await browser.close();
    } catch {
      /* ignore */
    }
  }

  return { getPage, closeTab, close, isolate, cdpUrl: cdpUrl() };
}
