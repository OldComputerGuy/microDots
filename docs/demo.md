# Recording the MicroDot demo

The README should show the agent *doing something* in ~20–30 seconds. A static
terminal still (`docs/assets/hero.png`) is already in the README as a stopgap;
the GIF below is the real upgrade. This is a manual step (it needs a real screen
recording), but here's the recipe.

To regenerate the static hero from a run: `node scripts/render-hero.mjs`.

## What to show

MicroDot's only UI is the terminal — so you're recording the **MicroDot CLI**
(`microdot.bat`) as it runs one task. There's no window or website to record.

1. **Start** — launch the interactive CLI; the header line + `/help` appear.
2. **Prompt** — type the task live at the `main@you>` prompt.
3. **Work** — the KITT scanner ticks; with `MICRODOT_VERBOSE=true` the tool lines
   (`→ web_search …`, `→ browser_open …`) scroll past.
4. **Browser** — the real Chromium window/tab opening (needs
   `MICRODOT_HEADLESS=false`, see below).
5. **Answer** — the reply streams in, markdown and all.

Keep it under 30s. No dead air; cut the waiting.

## Exact script

```powershell
# from C:\Users\Test\Desktop\dots\MicroDot
$env:MICRODOT_VERBOSE  = "true"    # show tool lines instead of just the scanner
$env:MICRODOT_HEADLESS = "false"   # IMPORTANT: show the real Chromium window
.\microdot.bat
```

Then type at the prompt:

```
Search the web for the latest stable Node.js LTS, open nodejs.org to confirm it, and give one source URL.
```

> **`MICRODOT_HEADLESS` defaults to `true`** — in that mode the browser is
> invisible and the demo looks like "just a chat". Set it to `false` so viewers
> see the agent actually drive a real browser tab.

**Framing options**

- **Terminal only** — simplest. Record the terminal (Area/Window) at ~100×30
  columns, font ~16–18pt so lines don't wrap and text stays legible.
- **Terminal + browser** (best) — with headful Chromium, put the browser window
  beside the terminal and record an **Area** covering both, so the tab opening
  is visible in-frame.
- **Optional second clip** — type `/new` to pop a fresh worker window; it shows
  the multi-agent `/new` → new agent + space + type behaviour.

## Tools

### Windows — ScreenToGif (recommended, no extras to install)

[ScreenToGif](https://www.screentogif.com/) records a region, a window, or the
whole screen, then edits frames before exporting.

1. Open ScreenToGif → **Recorder**.
2. Pick **Window** (click the terminal) or **Area** (frame just the terminal),
   set **FPS ≈ 12**.
3. **Record** → run the demo command → **Stop** (default hotkey `F7`).
4. In the editor: select dead air at the start/end and **Delete** it, then
   **Resize** to ~1000px wide.
5. **File → Save as → Gif**. Aim for ≤ 6 MB.

Tips: hide the taskbar, bump the console font to ~16–18pt, use a clean colour
scheme, and silence notifications. Recording at ~100×30 columns keeps lines from
wrapping.

### Windows — OBS + ffmpeg (best quality/size)

Record with OBS (or any capture) to `.mp4`/`.webm`, then:

```sh
# palette-based GIF (good quality); 12 fps, 1000px wide
ffmpeg -i demo.mp4 -vf "fps=12,scale=1000:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 docs/assets/demo.gif
```

Even better size/quality with [gifski](https://gif.ski):

```sh
gifski --fps 12 --width 1000 -o docs/assets/demo.gif demo.mp4
```

### Terminal-only — asciinema + agg

Cross-platform but assumes a Unix terminal, so it's awkward on Windows (run it
inside WSL, where MicroDot's CLI also runs):

```sh
asciinema rec demo.cast        # run the demo, then exit
agg demo.cast docs/assets/demo.gif
```

### Fully scripted (no screen recording)

If you'd rather not capture a screen at all, a GIF can be rendered from a real
captured run — same approach as `scripts/render-hero.mjs`, animated frame by
frame with the bundled Playwright Chromium. Ask and we can add
`scripts/render-demo.mjs`; it's reproducible and needs no recording software,
though it won't show the actual Chromium window opening.

## Add it to the README

Put the file at `docs/assets/demo.gif`, then add directly under the intro:

```markdown
![MicroDot running a task](docs/assets/demo.gif)
```

If the GIF gets large, keep a still frame (`docs/assets/hero.png`) in the README
and link the full video from the blog post instead — GitHub handles PNGs best.

## While you're at it

The same clip works as the X/LinkedIn post and the Product Hunt gallery. Record
once, trim twice.
