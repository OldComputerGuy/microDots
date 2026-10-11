// Build theme-aware logo assets from docs/assets/logo.png:
//   docs/assets/logo.png       — dark glyphs, transparent bg (GitHub light theme)
//   docs/assets/logo-dark.png  — light glyphs, transparent bg (GitHub dark theme)
//   node scripts/make-logo.mjs
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const assets = resolve(here, '..', 'docs', 'assets');
const src = resolve(assets, 'logo-source.png');
mkdirSync(assets, { recursive: true });

const b64 = readFileSync(src).toString('base64');

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<img id="i" src="data:image/png;base64,${b64}">`);

const out = await page.evaluate(async (TARGET_W) => {
  const img = document.getElementById('i');
  await img.decode();
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  const src = ctx.getImageData(0, 0, w, h).data;

  const lum = (i) => 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
  const bgA = src[3];
  const transparentBg = bgA < 10;
  const bgLum = transparentBg ? 255 : lum(0);

  // bounding box of ink
  let minX = w, minY = h, maxX = 0, maxY = 0, minLum = 255;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = src[i + 3];
      const ink = transparentBg ? a > 16 : bgLum - lum(i) > 32;
      if (ink) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        const L = lum(i);
        if (L < minLum) minLum = L;
      }
    }
  const pad = 6;
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(w - 1, maxX + pad);
  maxY = Math.min(h - 1, maxY + pad);
  const cw = maxX - minX + 1;
  const ch = maxY - minY + 1;
  const scale = Math.min(1, TARGET_W / cw);
  const ow = Math.round(cw * scale);
  const oh = Math.round(ch * scale);
  const span = Math.max(1, bgLum - minLum);

  const make = (color) => {
    const o = document.createElement('canvas');
    o.width = ow;
    o.height = oh;
    const octx = o.getContext('2d');
    const oimg = octx.createImageData(ow, oh);
    for (let y = 0; y < oh; y++)
      for (let x = 0; x < ow; x++) {
        const sx = Math.min(w - 1, Math.round(minX + x / scale));
        const sy = Math.min(h - 1, Math.round(minY + y / scale));
        const i = (sy * w + sx) * 4;
        let cov;
        if (transparentBg) cov = src[i + 3] / 255;
        else cov = Math.max(0, Math.min(1, (bgLum - lum(i)) / span));
        const oi = (y * ow + x) * 4;
        oimg.data[oi] = color[0];
        oimg.data[oi + 1] = color[1];
        oimg.data[oi + 2] = color[2];
        oimg.data[oi + 3] = Math.round(cov * 255);
      }
    octx.putImageData(oimg, 0, 0);
    return o.toDataURL('image/png').split(',')[1];
  };

  return { ow, oh, light: make([26, 28, 33]), dark: make([230, 237, 243]) };
}, 1400);

await browser.close();
writeFileSync(resolve(assets, 'logo.png'), Buffer.from(out.light, 'base64'));
writeFileSync(resolve(assets, 'logo-dark.png'), Buffer.from(out.dark, 'base64'));
console.log(`wrote logo.png + logo-dark.png (${out.ow}x${out.oh})`);
