# Example run

A real, unedited run — ANSI stripped, nothing added. This is the proof the demo
GIF would have shown, in text: copy-pasteable, diffable, and it doesn't go stale.

Command:

```sh
MICRODOT_VERBOSE=true microdot.bat --prompt "Search the web for the latest stable Node.js LTS, open nodejs.org to confirm it, and give one source URL."
```

Output:

```text
→ web_search {"query":"latest Node.js LTS version","objective":"Find the current stable Node.js LTS version"}
  ← web_search {"query":"latest Node.js LTS version","count":5,"results":[{"title":"Node.js — Run JavaScript Everywhere","url":"https://nodejs.org/tr/download/archive/v26.6.0","publish_date":null…
  → browser_open {"url":"https://nodejs.org"}
  ← browser_open {"status":200,"url":"https://nodejs.org/en","title":"Node.js — Run JavaScript Everywhere","text":"Skip to content\nLearn\nAbout\nDownload\nBlog\nDocs\nBeta Docs\nContribute\nStart …

Latest stable Node.js LTS: v24.21.0 ("Krypton")

• I searched for the current LTS and then opened https://nodejs.org/en, whose homepage footer states: "v24.21.0 — Latest LTS" (alongside "v26.11.1 — Latest Release", i.e. the Current line).
• Note: v26.x is the Current (non-LTS) line; v24.x is the active LTS, with v22.x ("Jod") also in LTS support.

Source URL: https://nodejs.org/en
```

## What to notice

- **Two tools, two kinds** — a `web_search` (Parallel) then a `browser_open`
  against the real shared Chromium, confirming the answer at the source rather
  than trusting the search snippet.
- **`←` lines are the tool results**, truncated by the CLI; the model sees more.
- **Verbose mode** (`MICRODOT_VERBOSE=true`) prints tool lines. Without it you
  just get the KITT scanner and the final answer.
- This ran **headless** (the default). Nothing is drawn to a browser window on
  a server; the tab is real, it's just not on a screen.

For an interactive session, `microdot.bat` with no `--prompt` drops you at a
`main@you>` prompt, where `/new` opens another worker (its own agent + space +
type) and `/resume` reloads a saved chat.
