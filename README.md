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
npx playwright install chromium        # Linux/VPS: npx playwright install --with-deps chromium
cp .env.example .env                   # Windows: copy .env.example .env
# set OPENROUTER_API_KEY in .env, or rely on an OpenRouterKey env var
```

## Run
```sh
minidot.bat                      # Windows: interactive CLI (agent "main")
./minidot.sh                     # Linux/VPS: same
minidot.bat --prompt "summarise https://example.com"
```
Watch the tabs: set `MINIDOT_HEADLESS=false` in `.env` **before first launch** (the shared Chromium is headful once started).

### REPL commands
| command | effect |
|---|---|
| `/new [name]` | open a **new CLI window** (new agent, own tab) |
| `/tools` | list built-in + custom tools, with descriptions and backend |
| `/delete <name>` | delete a custom tool (and its file) |
| `/skills` | list saved skills |
| `/reset` | reset this conversation |
| `/shots` | open the latest screenshot |
| `/help`, `/exit` | |

## Web search
MiniDot has a **`web_search`** tool backed by **Parallel** — the same provider OpenDots uses (`https://search.parallel.ai/mcp`). No API key is needed for light use; set `PARALLEL_API_KEY` for a higher authenticated tier.

- `web_search(query, objective?)` → `{ query, count, results: [{ title, url, publish_date, excerpt }] }` — for current information, news, docs, comparisons.
- `web_fetch(urls, objective?)` → the extracted content of specific pages — when you need exact wording, quotes, or full-page analysis.
- Both are **builtins**, so they run on the host even in sandbox mode. Prefer them over opening a search engine in the browser (which gets blocked).

## Skills (recipes)
MiniDot can save reusable **skills** — named markdown recipes/procedures (not code; that's `create_tool`). Stored in `./skills/<name>.md`.

- `save_skill(name, description, instructions)`, `list_skills()`, `read_skill(name)`, `delete_skill(name)`.
- At startup the available skills are listed in the system prompt, so MiniDot can `read_skill` one and follow it.

## Self-authored tools
MiniDot can **write its own tools** and use them immediately.

- Call **`create_tool`** with `name`, `description`, a JSON-Schema `parameters`, and the JS body of `async function run(args, ctx)`.
- The tool is registered live (callable in the **same** turn) and saved to `./tools-custom/<name>.mjs`.
- Saved tools **auto-load** at startup, so they persist across sessions.
- Manage them with **`list_tools`** (built-ins + your custom tools) and **`delete_tool`** (removes the tool and its file).
- `ctx` gives `page()` (your browser tab), `agentId`, `clip`, `textLimit`, `host`; you can also `await import('...')` Node modules and use global `fetch`.

Example tool file `tools-custom/slugify.mjs`:
```js
export const definition = { type:'function', function:{ name:'slugify', description:'…', parameters:{ type:'object', properties:{ text:{type:'string'} }, required:['text'] } } };
export async function run(args, ctx) {
  return { slug: String(args.text).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') };
}
```

> ⚠️ Custom tool code runs **in the MiniDot Node process with your full local privileges** (filesystem, network, child processes) when the sandbox is off. Only let it create tools you trust; review `./tools-custom/*.mjs` and delete anything unwanted.

### Tool sandbox backend (opt-in)
Set `MINIDOT_TOOL_SANDBOX` to anything other than `none` to run self-authored tools in an isolated **Linux worker** instead of in-process. One worker script, two launchers:

- **Windows:** the worker runs **inside WSL2** (spawned via `wsl.exe`). Requires Node in WSL: `wsl -- sudo apt-get install -y nodejs` (Node 18+ is enough).
- **Linux/VPS:** the worker runs **natively** — no WSL.
- **Confinement (`MINIDOT_SANDBOX_BWRAP=true`):** wrap the worker in `bubblewrap` — the system is mounted **read-only** and only `./workspace` is writable (verified: writes to `/root` and `/etc` → `EROFS`). Needs `bubblewrap` installed (Windows/WSL: `wsl -- sudo apt-get install -y bubblewrap`; Linux: `apt install bubblewrap`). Network still works so `ctx.fetch` functions; reads of other paths remain, and Windows interop isn't fully closed.

Either way:
- `ctx.fs` is jailed to `./workspace` (or `MINIDOT_SANDBOX_DIR`); `ctx.fetch` runs natively in the worker; `ctx.browser.*` and `ctx.openPath` are **bridged back to the host** (the shared Chromium / OS viewer).
- Tools get `ctx.browser.{open,text,url,screenshot,click,type,close}` + `ctx.fs` instead of the in-process `page()`/`host`/`import()`.

> ⚠️ With `bwrap` on, the system is read-only and only the workspace is writable; without it, WSL mode is functional-but-loose (default user, interop, `/mnt/c`). Fully closing interop/reads needs a dedicated distro.

## Running on a Linux VPS (Hetzner)
The core is portable — Node, Playwright, the model loop, Parallel search and your tools all move over unchanged. To prep a box:

- `npm install` and `npx playwright install --with-deps chromium`; set `MINIDOT_HEADLESS=true` and `MINIDOT_OPEN_SHOTS=false` (no display on a server).
- Launch with `./minidot.sh`. Run several **agents as separate processes** (or `tmux` windows) — they all attach to the one shared Chromium over CDP. `/new` uses `tmux` when inside a tmux session, else a terminal emulator, else a detached process.
- The shared Chromium binds to **localhost** (`MINIDOT_CDP_URL`); never expose that port. Optionally run MiniDot under `systemd`/`tmux` for persistence.
- If running as **root**, Chromium needs `--no-sandbox` (MiniDot adds it automatically on Linux root; override with `MINIDOT_CHROMIUM_ARGS`).
- For a real sandbox, use `bubblewrap` (`MINIDOT_SANDBOX_BWRAP=true`) or a container — Linux gives you proper namespaces, no WSL/interop hacks.

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
| `MINIDOT_SKILLS_DIR` | `skills` | folder for saved skills (recipes) |
| `MINIDOT_APPROVE_CREATE_TOOL` | `true` | ask before saving a new tool (interactive) |
| `PARALLEL_API_KEY` | — | optional; Parallel search key (anonymous free tier works without it) |
| `MINIDOT_TOOL_SANDBOX` | `none` | anything else = run tools in the isolated Linux worker (WSL on Windows, native on Linux) |
| `MINIDOT_SANDBOX_DIR` | `workspace` | folder tools may read/write in sandbox mode |
| `MINIDOT_SANDBOX_BWRAP` | `false` | Linux: wrap the worker in `bubblewrap` (read-only root, only workspace writable) |
| `MINIDOT_WSL_DISTRO` | `Ubuntu-24.04` | WSL distro to use (Windows) |
| `MINIDOT_WSL_TIMEOUT_MS` | `60000` | per-call timeout (worker is killed on timeout) |
| `MINIDOT_NODE` | `node` | Node binary used to launch the worker (Linux) |
| `MINIDOT_CHROMIUM_ARGS` | — | extra Chromium flags (e.g. `--no-sandbox`) |
| `MINIDOT_TERMINAL` | `x-terminal-emulator` | terminal used by `/new` on Linux (outside tmux) |
| `MINIDOT_AGENT` | `main` | agent name for this CLI window |
| `MINIDOT_MAX_STEPS` | `12` | max tool-loop steps per turn |
| `MINIDOT_TEXT_LIMIT` | `32768` | max characters returned from a page |

## Notes
- Assistant replies are rendered as **coloured terminal markdown** (headings, bullets, bold/italic, inline code, fenced code blocks, links, rules).
- Screenshots are written to `./screenshots/` (named per agent) at `MINIDOT_VIEWPORT` size (default 1600×1000).
- The shared Chromium uses a profile at `./.chromium-profile/`.
- To stop the shared browser, close its window (headful) or end the `chrome`/`chrome.exe` process.
- Completely independent of the OpenDots app.


