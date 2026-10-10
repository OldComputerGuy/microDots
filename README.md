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
minidot.bat --prompt-file task.md      # read a multi-line prompt from a file
```
Watch the tabs: set `MINIDOT_HEADLESS=false` in `.env` **before first launch** (the shared Chromium is headful once started).

### REPL commands
| command | effect |
|---|---|
| `/new [name] [type]` | open a **new worker** (own CLI + space + worker type) |
| `/paste` | paste a **multi-line prompt** (finish with a line containing only `.`) |
| `/tools` | list built-in + custom tools, with descriptions and backend |
| `/delete <name>` | delete a custom tool (and its file) |
| `/skills` | list saved skills |
| `/type [name]` | show or set this worker's type |
| `/mission [text]` | show or set this space's `mission.md` |
| `/reset` | reset this conversation |
| `/shots` | open the latest screenshot |
| `/help`, `/exit` | |

## Spaces & missions
Every worker gets its **own space**, named after it:

```
spaces/
  <worker_name>/
    mission.md      the Dot's standing objective (injected into the system prompt)
    shots/          screenshots
    <other files>   notes, documents, downloads the worker produces
```

- The space is also the **sandbox root**, so a tool's `ctx.fs` writes land in `spaces/<worker>/` — enforced, not convention.
- `mission.md` is created on first run (seed it via `MINIDOT_MISSION`) and shown to the worker each session; edit it directly or with `/mission <text>`.
- The chosen **worker type** is recorded in `spaces/<worker>/worker_type` so it persists.
- `/new alpha` makes a new worker with its own `spaces/alpha/`. Set `MINIDOT_SPACE=research` to point a worker at a specific (possibly shared) space.

## Worker types
A **worker type** is a markdown file describing *how a worker behaves* (persona, method, rules). It lives in `./worker-types/<name>.md` and is injected into the worker's system prompt.

- **Handwritten:** just drop a file in `./worker-types/`. Shipped: `default`, `researcher`.
- **On the fly:** the worker can author them with `save_worker_type(name, description, content)` (`list_worker_types` / `read_worker_type` / `delete_worker_type` too).
- **Assigned at creation:** `/new <name> <type>` — **no type stated → `default`**. Change it later with `/type <name>`.

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
- **Confinement (`MINIDOT_SANDBOX_BWRAP=true`):** wrap the worker in `bubblewrap` — the system is mounted **read-only** and only the worker's space is writable (verified: writes to `/root` and `/etc` → `EROFS`). Needs `bubblewrap` installed (Windows/WSL: `wsl -- sudo apt-get install -y bubblewrap`; Linux: `apt install bubblewrap`). Network still works so `ctx.fetch` functions; reads of other paths remain, and Windows interop isn't fully closed. If `bubblewrap` is missing, MiniDot logs a warning and **falls back to the unconfined worker** — best-effort confinement, never a hard failure.

Either way:
- `ctx.fs` is jailed to the worker's space (`spaces/<worker>/`, or `MINIDOT_SANDBOX_DIR`); `ctx.fetch` runs natively in the worker; `ctx.browser.*` and `ctx.openPath` are **bridged back to the host** (the shared Chromium / OS viewer).
- Tools get `ctx.browser.{open,text,url,screenshot,click,type,close}` + `ctx.fs` instead of the in-process `page()`/`host`/`import()`.

> ⚠️ With `bwrap` on, the system is read-only and only the workspace is writable; without it, WSL mode is functional-but-loose (default user, interop, `/mnt/c`). Fully closing interop/reads needs a dedicated distro.

## Running on a Linux VPS (Hetzner)
The core is portable — Node, Playwright, the model loop, Parallel search and your tools all move over unchanged. To prep a box:

- `npm install` and `npx playwright install --with-deps chromium`; set `MINIDOT_HEADLESS=true` and `MINIDOT_OPEN_SHOTS=false` (no display on a server).
- Launch with `./minidot.sh`. Run several **agents as separate processes** (or `tmux` windows) — they all attach to the one shared Chromium over CDP. `/new` uses `tmux` when inside a tmux session, else a terminal emulator, else a detached process.
- The shared Chromium binds to **localhost** (`MINIDOT_CDP_URL`); never expose that port. Optionally run MiniDot under `systemd`/`tmux` for persistence.
- If running as **root**, Chromium needs `--no-sandbox` (MiniDot adds it automatically on Linux root; override with `MINIDOT_CHROMIUM_ARGS`).
- For a real sandbox, use `bubblewrap` (`MINIDOT_SANDBOX_BWRAP=true`) or a container — Linux gives you proper namespaces, no WSL/interop hacks.

## Sub-agents (opt-in)
With `MINIDOT_ALLOW_SPAWN=true`, a worker gets **`spawn_subagent({ mission, name?, type?, context?, deliverables? })`** and **`spawn_subagents({ tasks, concurrency? })`**: it designs tight, specialized missions and sub-agents run them autonomously — one at a time, or several **in parallel** (bounded by `MINIDOT_MAX_CONCURRENT`) — then report back.

- **Nested spaces:** the child works in `<parent space>/subagents/<name>/` (siblings unique, auto-suffixed), so the filesystem mirrors the agent tree and names never clash.
- **Results roll up:** each child returns a **recursive digest** — `{ child, space, status, summary, findings, sources, artifacts, report_path, children[] }` — and writes `report.md`/`report.json` in its space. The root ends up with the whole tree's findings.
- **Caps (hard):** `MINIDOT_MAX_DEPTH` (default 3), `MINIDOT_MAX_AGENTS` (16, counted across the whole tree), `MINIDOT_MAX_CONCURRENT` (8), and off by default. Over-limit spawns are denied without creating a folder.
- **Cleanup:** the sub-agent tree is scratch — removed at the end of the run. **`MINIDOT_DEBUG=true` keeps it** (for inspecting the process).
- **Per-agent tabs:** every agent — the root and each child — gets its **own tab** on the shared Chromium, opened when the agent starts and **closed when it finishes**. The sandbox browser bridge is **per-run**, so parallel children never fight over (or cross wires to) the wrong tab.

```
spaces/main/subagents/node-lts/
  mission.md  worker_type  report.md  report.json  shots/
```

## Context compaction
Long runs don't grow without bound. With `MINIDOT_COMPACT=true`:

- When the estimated context (`chars ÷ MINIDOT_CHARS_PER_TOKEN`) exceeds **`MINIDOT_CONTEXT_TOKENS`**, the **oldest messages are summarized** (a rolling summary) and replaced. Kept: the system prompt + the summary + the last **`MINIDOT_KEEP_RECENT`** messages. Tool‑call/result pairs are never split.
- Tool outputs larger than **`MINIDOT_OFFLOAD_TOKENS`** are written in full to `spaces/<worker>/notes/` and replaced in context by a short head **+ a pointer** — so nothing is lost.

Applies to the root agent **and every sub-agent**. Each compaction costs one extra (non‑streaming) model call; set `MINIDOT_SUMMARY_MODEL` to a cheaper model for those. The token counts are approximate (no local tokenizer), governed by the chars/token ratio.

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
| `MINIDOT_WORKER_TYPES_DIR` | `worker-types` | folder for worker-type behaviour files |
| `MINIDOT_WORKER_TYPE` | *(space)* | worker type for a new worker (else the space's, else `default`) |
| `MINIDOT_APPROVE_CREATE_TOOL` | `true` | ask before saving a new tool (interactive) |
| `MINIDOT_ALLOW_SPAWN` | `false` | enable the `spawn_subagent` tool |
| `MINIDOT_MAX_DEPTH` | `3` | max sub-agent nesting depth |
| `MINIDOT_MAX_AGENTS` | `16` | max agents per run (whole tree) |
| `MINIDOT_MAX_CONCURRENT` | `8` | max sub-agents running at once |
| `MINIDOT_DEBUG` | `false` | keep sub-agent spaces + verbose logs |
| `PARALLEL_API_KEY` | — | optional; Parallel search key (anonymous free tier works without it) |
| `MINIDOT_TOOL_SANDBOX` | `none` | anything else = run tools in the isolated Linux worker (WSL on Windows, native on Linux) |
| `MINIDOT_SANDBOX_DIR` | — | advanced: explicit sandbox root; overrides `spaces/<worker>` |
| `MINIDOT_SPACE` | worker name | space to use (an agent can attach to a shared space) |
| `MINIDOT_MISSION` | — | initial `mission.md` text if the file doesn't exist |
| `MINIDOT_SANDBOX_BWRAP` | `false` | Linux: wrap the worker in `bubblewrap` (read-only root, only workspace writable) |
| `MINIDOT_WSL_DISTRO` | `Ubuntu-24.04` | WSL distro to use (Windows) |
| `MINIDOT_WSL_TIMEOUT_MS` | `60000` | per-call timeout (worker is killed on timeout) |
| `MINIDOT_NODE` | `node` | Node binary used to launch the worker (Linux) |
| `MINIDOT_CHROMIUM_ARGS` | — | extra Chromium flags (e.g. `--no-sandbox`) |
| `MINIDOT_TERMINAL` | `x-terminal-emulator` | terminal used by `/new` on Linux (outside tmux) |
| `MINIDOT_AGENT` | `main` | agent name for this CLI window |
| `MINIDOT_MAX_STEPS` | `12` | max tool-loop steps per turn |
| `MINIDOT_TEXT_LIMIT` | `32768` | max characters of a tool result fed to the model |
| `MINIDOT_TEXT_TOKENS` | — | if set, budget tool results in **tokens** instead (overrides `TEXT_LIMIT`) |
| `MINIDOT_CHARS_PER_TOKEN` | `4` | ratio used to convert the token budget to characters |
| `MINIDOT_COMPACT` | `false` | enable context compaction (trim + summarize) |
| `MINIDOT_CONTEXT_TOKENS` | `24000` | summarize when estimated context exceeds this |
| `MINIDOT_KEEP_RECENT` | `6` | recent messages kept verbatim during compaction |
| `MINIDOT_OFFLOAD_TOKENS` | `4000` | offload tool outputs larger than this to the space |
| `MINIDOT_SUMMARY_MODEL` | *(MINIDOT_MODEL)* | model used for summaries |

## Notes
- Assistant replies are rendered as **coloured terminal markdown** (headings, bullets, bold/italic, inline code, fenced code blocks, links, rules).
- Screenshots are written to `spaces/<worker>/shots/` (per worker) at `MINIDOT_VIEWPORT` size (default 1600×1000).
- The shared Chromium uses a profile at `./.chromium-profile/`.
- To stop the shared browser, close its window (headful) or end the `chrome`/`chrome.exe` process.
- Completely independent of the OpenDots app.


