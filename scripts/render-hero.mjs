// Render docs/assets/hero.png — a terminal-style still of a real MicroDot run.
// Re-run after a demo:  node scripts/render-hero.mjs  (uses the bundled Playwright Chromium)
//
// The lines below are a faithful, lightly trimmed view of an actual run:
//   microdot --prompt "Search the web for the latest stable Node.js LTS
//                       version, then open nodejs.org to confirm it.
//                       Give one source URL."
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '..', 'docs', 'assets');
const out = resolve(outDir, 'hero.png');
mkdirSync(outDir, { recursive: true });

const lines = [
  '<span class="ps">PS C:\\Users\\Test\\Desktop\\dots&gt;</span> <span class="cmd">microdot --prompt "latest stable Node.js LTS?"</span>',
  '&nbsp;',
  '<span class="brand">&#9679; MicroDot</span><span class="dim"> &middot; main</span>',
  '&nbsp;',
  '<span class="arrow">&#8594;</span> <span class="tool">web_search</span>   <span class="args">{"query":"latest stable Node.js LTS version"}</span>',
  '<span class="res">&#8592;</span> <span class="rdim">web_search   5 results &middot; nodejs.org/en/download/archive/current</span>',
  '<span class="arrow">&#8594;</span> <span class="tool">browser_open</span> <span class="args">{"url":"https://nodejs.org"}</span>',
  '<span class="res">&#8592;</span> <span class="rdim">browser_open 200 &middot; "Node.js &mdash; Run JavaScript Everywhere"</span>',
  '&nbsp;',
  '<span class="answer">Latest stable Node.js LTS: v24.21.0 ("Krypton").</span>',
  '<span class="answer">v26.11.1 is the Current (non-LTS) release.</span>',
  '&nbsp;',
  '<span class="answer">Source: </span><span class="link">https://nodejs.org/en</span>',
];

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #070a10; padding: 28px; font-family: "Cascadia Mono","Cascadia Code",Consolas,"SF Mono",ui-monospace,Menlo,monospace; }
  .win { width: 984px; background: #0d121b; border: 1px solid #1d2734; border-radius: 12px; overflow: hidden; box-shadow: 0 24px 60px rgba(0,0,0,.55); }
  .bar { height: 40px; background: #141b26; border-bottom: 1px solid #1d2734; display: flex; align-items: center; padding: 0 14px; gap: 8px; }
  .dot { width: 12px; height: 12px; border-radius: 50%; }
  .r { background: #ff5f56; } .y { background: #ffbd2e; } .g { background: #27c93f; }
  .title { margin-left: 10px; color: #7d8795; font-size: 13px; }
  .body { padding: 18px 22px 22px; font-size: 15px; line-height: 1.62; color: #c9d1d9; white-space: pre; }
  .ps { color: #58a6ff; } .cmd { color: #e6edf3; }
  .brand { color: #f0b429; font-weight: 700; } .dim { color: #6e7681; }
  .arrow { color: #56d4dd; } .tool { color: #7ee787; } .args { color: #8b949e; }
  .res { color: #6e7681; } .rdim { color: #8b949e; }
  .answer { color: #e6edf3; } .link { color: #58a6ff; text-decoration: underline; text-underline-offset: 2px; }
</style></head>
<body><div class="win">
  <div class="bar"><span class="dot r"></span><span class="dot y"></span><span class="dot g"></span><span class="title">MicroDot &mdash; main</span></div>
  <div class="body">${lines.join('\n')}</div>
</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1040, height: 500 }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'load' });
await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1040, height: 500 } });
await browser.close();
console.log('wrote', out);
