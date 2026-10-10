# MiniDot

A bare-bones multi-agent CLI where **each CLI window is its own agent** and all agents share **one Chromium**, each in its own tab.
No CopilotKit, no React, no server, no Docker.

## Architecture
- The first MiniDot CLI **launches one Chromium** (persistent, headless or headful) exposing CDP.
- Every CLI process is **one agent**, connects to that Chromium, and works in **its own tab**.
- `/new` opens a **new CLI window** (a new agent) attached to the same Chromium.
- Closing an agent only closes its tab / disconnects; the shared Chromium keeps running.

## Setup
```sh
npm install
npx playwright install chromium
copy .env.example .env
# set OPENROUTER_API_KEY in .env, or rely on an OpenRouterKey env var
```

## Run
```sh
minidot.bat                      # interactive CLI (agent "main")
minidot.bat --prompt "summarise https://example.com"
```
Watch the tabs: set `MINIDOT_HEADLESS=false` in `.env` **before first launch** (the shared Chromium is headful once started).

### REPL commands
| command | effect |
|---|---|
| `/new [name]` | open a **new CLI window** (new agent, own tab) |
| `/reset` | reset this conversation |
| `/shots` | open the latest screenshot |
| `/tools`, `/help`, `/exit` | |

## Self-authored tools
MiniDot can **write its own tools** and use them immediately.

- Call **`create_tool`** with `name`, `description`, a JSON-Schema `parameters`, and the JS body of `async function run(args, ctx)`.
- The tool is registered live (callable in the **same** turn) and saved to `./tools-custom/<name>.mjs`.
- Saved tools **auto-load** at startup, so they persist across sessions.
- `ctx` gives `page()` (your browser tab), `agentId`, `clip`, `textLimit`, `host`; you can also `await import('...')` Node modules and use global `fetch`.

Example tool file `tools-custom/slugify.mjs`:
```js
export const definition = { type:'function', function:{ name:'slugify', description:'…', parameters:{ type:'object', properties:{ text:{type:'string'} }, required:['text'] } } };
export async function run(args, ctx) {
  return { slug: String(args.text).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') };
}
```

> ⚠️ Custom tool code runs **in the MiniDot Node process with your full local privileges** (filesystem, network, child processes). Only let it create tools you trust; review `./tools-custom/*.mjs` and delete anything unwanted.

## Config (`.env`)
| var | default | meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | — | model key (falls back to `OpenRouterKey` env) |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible endpoint |
| `MINIDOT_MODEL` | `deepseek/deepseek-v4.1-flash` | model id |
| `MINIDOT_HEADLESS` | `true` | `false` = headful shared Chromium (tabs visible) |
| `MINIDOT_OPEN_SHOTS` | `true` | open screenshots in the default viewer |
| `MINIDOT_ISOLATE_AGENTS` | `false` | `true` = separate browser context per agent |
| `MINIDOT_CDP_URL` | `http://127.0.0.1:9222` | shared Chromium debug endpoint |
| `MINIDOT_VIEWPORT` | `1600x1000` | page/screenshot size (WIDTHxHEIGHT) |
| `MINIDOT_SHOT_QUALITY` | `80` | JPEG quality (1–100) |
| `MINIDOT_SHOT_SCALE` | `1` | device pixel ratio (`2` = crisper, larger images; isolate mode) |
| `MINIDOT_SHOT_FULLPAGE` | `false` | `true` = capture the whole page, not just the viewport |
| `MINIDOT_SHOT_KEEP` | `10` | keep only the newest N screenshots; older ones are deleted |
| `MINIDOT_TOOLS_DIR` | `tools-custom` | folder for self-authored tools |
| `MINIDOT_AGENT` | `main` | agent name for this CLI window |
| `MINIDOT_MAX_STEPS` | `12` | max tool-loop steps per turn |
| `MINIDOT_TEXT_LIMIT` | `8000` | max characters returned from a page |

## Notes
- Assistant replies are rendered as **coloured terminal markdown** (headings, bullets, bold/italic, inline code, fenced code blocks, links, rules).
- Screenshots are written to `./screenshots/` (named per agent) at `MINIDOT_VIEWPORT` size (default 1600×1000).
- The shared Chromium uses a profile at `./.chromium-profile/`.
- To stop the shared browser, close its window (headful) or end the `chrome.exe` process.
- Completely independent of the OpenDots app.


