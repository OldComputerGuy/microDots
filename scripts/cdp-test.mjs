import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const CDP = process.env.MINIDOT_CDP_URL ?? 'http://127.0.0.1:9222';
const headless = (process.env.MINIDOT_HEADLESS ?? 'true') !== 'false';
const exe = chromium.executablePath();
console.log('executablePath:', exe);
console.log('headless:', headless);

const userDir = resolve(process.cwd(), '.chromium-profile');
mkdirSync(userDir, { recursive: true });
const args = [
  '--remote-debugging-port=' + (new URL(CDP).port || '9222'),
  '--user-data-dir=' + userDir,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-networking',
];
if (headless) args.push('--headless=new');
args.push('about:blank');
const child = spawn(exe, args, { detached: true, stdio: 'ignore' });
child.unref();
console.log('spawned pid', child.pid);

let ready = false;
for (let i = 0; i < 40; i++) {
  try {
    const r = await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(1500) });
    if (r.ok) { ready = true; break; }
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}
console.log('cdp ready:', ready);
if (!ready) process.exit(1);

const browser = await chromium.connectOverCDP(CDP);
console.log('contexts:', browser.contexts().length);
const ctx = browser.contexts()[0] ?? (await browser.newContext());
const page = await ctx.newPage();
await page.goto('https://example.com', { waitUntil: 'domcontentloaded' });
console.log('tab title:', await page.title());
// open a second tab from a second connection
const browser2 = await chromium.connectOverCDP(CDP);
const ctx2 = browser2.contexts()[0] ?? (await browser2.newContext());
const page2 = await ctx2.newPage();
await page2.goto('https://example.org', { waitUntil: 'domcontentloaded' });
console.log('second tab title:', await page2.title());
console.log('total open pages:', browser.contexts()[0].pages().length);
await browser.close();
await browser2.close();
console.log('done (shared browser stays alive)');
