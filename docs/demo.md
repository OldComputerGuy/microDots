# Recording the MicroDot demo

The README should show the agent *doing something* in ~20–30 seconds. This is a
manual step (it needs a real screen recording), but here's the recipe.

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

- **Cross-platform (terminal):** [asciinema](https://asciinema.org) to record,
  [agg](https://github.com/asciinema/agg) to turn the `.cast` into a GIF.
  ```sh
  asciinema rec demo.cast
  # run the demo, then exit
  agg demo.cast docs/assets/demo.gif
  ```
- **Windows:** [ScreenToGif](https://www.screentogif.com/) (best) or OBS Studio.
  Record the terminal window only; export GIF ≤ 6 MB, ~1000px wide.

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
