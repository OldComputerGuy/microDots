# Recording the MicroDot demo

The README should show the agent *doing something* in ~20–30 seconds. A static
terminal still (`docs/assets/hero.png`) is already in the README as a stopgap;
the GIF below is the real upgrade. This is a manual step (it needs a real screen
recording), but here's the recipe.

To regenerate the static hero from a run: `node scripts/render-hero.mjs`.

## What to show

1. **Start** — `microdot.bat --prompt "..."` and the KITT scanner ticking.
2. **A tool call** — a search/fetch line (run with `MICRODOT_VERBOSE=true`).
3. **A browser action** — the shared Chromium visibly opening the page.
4. **A sub-agent fan-out** (optional, if quick) — the spawn lines.
5. **Result** — the final answer.

Keep it under 30s. No dead air; cut the waiting.

## Suggested task

A single prompt that uses search + the browser and finishes fast:

```sh
MICRODOT_VERBOSE=true microdot.bat --prompt "What is the latest stable Node.js LTS? Open nodejs.org, confirm it, and give one source URL."
```

On Windows keep the terminal at ~100×30 so text is legible at 2× speed.

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
