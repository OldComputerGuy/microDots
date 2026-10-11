# MicroDot

A bare-bones multi-agent CLI where **each CLI window is its own agent** and all agents share **one Chromium**, each in its own tab.
No CopilotKit, no React, no server, no Docker.

## Architecture
- The first MicroDot CLI **launches one Chromium** (persistent, headless or headful) exposing CDP.
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
microdot.bat                      # Windows: interactive CLI (agent "main")
./microdot.sh                     # Linux/VPS: same
microdot.bat --prompt "summarise https://example.com"
microdot.bat --prompt-file task.md      # read a multi-line prompt from a file
microdot.bat --resume <id>              # resume a saved chat (see /resume)
```
Watch the tabs: set `MICRODOT_HEADLESS=false` in `.env` **before first launch** (the shared Chromium is headful once started).

### REPL commands
| command | effect |
|---|---|
| `/new [name] [type]` | open a **new worker** (own CLI + space + worker type) |
| `/paste` | paste a **multi-line prompt** (finish with a line containing only `.`) |
| `/tools` | list built-in + custom tools, with descriptions and backend |
| `/delete <name>` | delete a custom tool (and its file) |
| `/skills` | list saved skills |
| `/resume [id]` | list saved chats, or resume one by id/prefix/title |
| `/name [title]` | show or set this chat's title |
| `/type [name]` | show or set this worker's type |
| `/mission [text]` | show or set this space's `mission.md` |
| `/reset` | reset this conversation |
| `/shots` | open the latest screenshot |
| `/help`, `/exit` | |

## Spaces & missions
Every worker gets its **own space**, named after it, inside the project layer:

```
<project>/.microdot/
  .gitignore            "*"  (self-ignoring)
  spaces/
    <worker_name>/
      mission.md        the Dot's standing objective (injected into the system prompt)
      shots/            screenshots
      worker_type       the chosen worker type
      <other files>     notes, documents, downloads the worker produces
  chats/
  tools/ skills/ worker-types/    project-specific additions
```

- The space is also the **sandbox root**, so a tool's `ctx.fs` writes land in `<project>/.microdot/spaces/<worker>/` — enforced, not convention.
- `mission.md` is created on first run (seed it via `MICRODOT_MISSION`) and shown to the worker each session; edit it directly or with `/mission <text>`.
- `/new alpha` makes a new worker with its own space. Set `MICRODOT_SPACE=research` to point a worker at a specific (possibly shared) space.

## Files & layers
MicroDot has two layers (like Codex/OpenCode keying to a project):

- **Engine** — the install dir (where the code lives, override with `MICRODOT_HOME`). Holds the **shared Chromium profile**, the **shipped worker-types/skills/tools** (e.g. `default`, `researcher`, `nasdaq100_momentum`), and the engine-level `tools-custom/`.
- **Project** — `<launch dir>/.microdot` (the folder you start MicroDot from). Holds **chats**, **spaces**, and any **project-specific tools/skills/worker-types**.

Resolution is **engine + project**, project overriding by name; **new** tools/skills/worker-types are written to the **project**. So a project can *add* to the engine set but never loses the defaults. The Chromium profile stays engine-level (one shared browser, one CDP port).

`MICRODOT_TOOLS_DIR` / `MICRODOT_SKILLS_DIR` / `MICRODOT_WORKER_TYPES_DIR` / `MICRODOT_SANDBOX_DIR` / `MICRODOT_CHATS_DIR` act as explicit single-dir overrides when set.

## Worker types
A **worker type** is a markdown file describing *how a worker behaves* (persona, method, rules). Engine types live in `<install>/worker-types/<name>.md`; project ones in `<project>/.microdot/worker-types/`. It's injected into the worker's system prompt.

- **Handwritten:** drop a file in either layer. Shipped: `default`, `researcher`.
- **On the fly:** the worker can author them with `save_worker_type(name, description, content)` (`list_worker_types` / `read_worker_type` / `delete_worker_type` too) — written to the project.
- **Assigned at creation:** `/new <name> <type>` — **no type stated → `default`**. Change it later with `/type <name>`.

## Web search
MicroDot has a **`web_search`** tool backed by **Parallel** — the same provider OpenDots uses (`https://search.parallel.ai/mcp`). No API key is needed for light use; set `PARALLEL_API_KEY` for a higher authenticated tier.

- `web_search(query, objective?)` → `{ query, count, results: [{ title, url, publish_date, excerpt }] }` — for current information, news, docs, comparisons.
- `web_fetch(urls, objective?)` → the extracted content of specific pages — when you need exact wording, quotes, or full-page analysis.
- Both are **builtins**, so they run on the host even in sandbox mode. Prefer them over opening a search engine in the browser (which gets blocked).

## Skills (recipes)
MicroDot can save reusable **skills** — named markdown recipes/procedures (not code; that's `create_tool`). Stored in `./skills/<name>.md`.

- `save_skill(name, description, instructions)`, `list_skills()`, `read_skill(name)`, `delete_skill(name)`.
- At startup the available skills are listed in the system prompt, so MicroDot can `read_skill` one and follow it.

## Self-authored tools
MicroDot can **write its own tools** and use them immediately.

- Call **`create_tool`** with `name`, `description`, a JSON-Schema `parameters`, and the JS body of `async function run(args, ctx)`.
- The tool is registered live (callable in the **same** turn) and saved to `./tools-custom/<name>.mjs`.
- Saved tools **auto-load** at startup, so they persist across sessions.
- Manage them with **`list_tools`** (built-ins + your custom tools) and **`delete_tool`** (removes the tool and its file).
- **Approval is pattern-gated:** harmless tools are saved silently; a tool whose code touches risky capabilities (`child_process`, `require`, dynamic `import`, direct `fs`/`fetch`, absolute paths, `process`, `eval`) prompts for y/N first. Disable with `MICRODOT_APPROVE_CREATE_TOOL=false`.
- `ctx` gives `page()` (your browser tab), `agentId`, `clip`, `textLimit`, `host`; you can also `await import('...')` Node modules and use global `fetch`.

Example tool file `tools-custom/slugify.mjs`:
```js
export const definition = { type:'function', function:{ name:'slugify', description:'…', parameters:{ type:'object', properties:{ text:{type:'string'} }, required:['text'] } } };
export async function run(args, ctx) {
  return { slug: String(args.text).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'') };
}
```

> ⚠️ Custom tool code runs **in the MicroDot Node process with your full local privileges** (filesystem, network, child processes) when the sandbox is off. Only let it create tools you trust; review `./tools-custom/*.mjs` and delete anything unwanted.

### Tool sandbox backend (opt-in)
Set `MICRODOT_TOOL_SANDBOX` to anything other than `none` to run self-authored tools in an isolated **Linux worker** instead of in-process. One worker script, two launchers:

- **Windows:** the worker runs **inside WSL2** (spawned via `wsl.exe`). Requires Node in WSL: `wsl -- sudo apt-get install -y nodejs` (Node 18+ is enough).
- **Linux/VPS:** the worker runs **natively** — no WSL.
- **Confinement (`MICRODOT_SANDBOX_BWRAP=true`):** wrap the worker in `bubblewrap` — the system is mounted **read-only** and only the worker's space is writable (verified: writes to `/root` and `/etc` → `EROFS`). Needs `bubblewrap` installed (Windows/WSL: `wsl -- sudo apt-get install -y bubblewrap`; Linux: `apt install bubblewrap`). Network still works so `ctx.fetch` functions; reads of other paths remain, and Windows interop isn't fully closed. If `bubblewrap` is missing, MicroDot logs a warning and **falls back to the unconfined worker** — best-effort confinement, never a hard failure.

Either way:
- `ctx.fs` is jailed to the worker's space (`<project>/.microdot/spaces/<worker>/`, or `MICRODOT_SANDBOX_DIR`); `ctx.fetch` runs natively in the worker; `ctx.browser.*` and `ctx.openPath` are **bridged back to the host** (the shared Chromium / OS viewer).
- Tools get `ctx.browser.{open,text,url,screenshot,click,type,close}` + `ctx.fs` instead of the in-process `page()`/`host`/`import()`.

> ⚠️ With `bwrap` on, the system is read-only and only the workspace is writable; without it, WSL mode is functional-but-loose (default user, interop, `/mnt/c`). Fully closing interop/reads needs a dedicated distro.

## Running on a Linux VPS (Hetzner)
The core is portable — Node, Playwright, the model loop, Parallel search and your tools all move over unchanged. To prep a box:

- `npm install` and `npx playwright install --with-deps chromium`; set `MICRODOT_HEADLESS=true` and `MICRODOT_OPEN_SHOTS=false` (no display on a server).
- Launch with `./microdot.sh`. Run several **agents as separate processes** (or `tmux` windows) — they all attach to the one shared Chromium over CDP. `/new` uses `tmux` when inside a tmux session, else a terminal emulator, else a detached process.
- The shared Chromium binds to **localhost** (`MICRODOT_CDP_URL`); never expose that port. Optionally run MicroDot under `systemd`/`tmux` for persistence.
- If running as **root**, Chromium needs `--no-sandbox` (MicroDot adds it automatically on Linux root; override with `MICRODOT_CHROMIUM_ARGS`).
- For a real sandbox, use `bubblewrap` (`MICRODOT_SANDBOX_BWRAP=true`) or a container — Linux gives you proper namespaces, no WSL/interop hacks.

## Sub-agents (opt-in)
With `MICRODOT_ALLOW_SPAWN=true`, a worker gets **`spawn_subagent({ mission, name?, type?, context?, deliverables? })`** and **`spawn_subagents({ tasks, concurrency? })`**: it designs tight, specialized missions and sub-agents run them autonomously — one at a time, or several **in parallel** (bounded by `MICRODOT_MAX_CONCURRENT`) — then report back.

- **Nested spaces:** the child works in `<parent space>/subagents/<name>/` (siblings unique, auto-suffixed), so the filesystem mirrors the agent tree and names never clash.
- **Results roll up:** each child returns a **recursive digest** — `{ child, space, status, summary, findings, sources, artifacts, report_path, children[] }` — and writes `report.md`/`report.json` in its space. The root ends up with the whole tree's findings.
- **Caps (hard):** `MICRODOT_MAX_DEPTH` (default 3), `MICRODOT_MAX_AGENTS` (16, counted across the whole tree), `MICRODOT_MAX_CONCURRENT` (8), and off by default. Over-limit spawns are denied without creating a folder.
- **Cleanup:** the sub-agent tree is scratch — removed at the end of the run. **`MICRODOT_DEBUG=true` keeps it** (for inspecting the process).
- **Per-agent tabs:** every agent — the root and each child — gets its **own tab** on the shared Chromium, opened when the agent starts and **closed when it finishes**. The sandbox browser bridge is **per-run**, so parallel children never fight over (or cross wires to) the wrong tab.

```
spaces/main/subagents/node-lts/
  mission.md  worker_type  report.md  report.json  shots/
```

## Resuming chats
Every conversation is saved **per project** — under `<launch dir>/.microdot/chats/<id>.json`, where the launch dir is the folder you started MicroDot from (like Codex/OpenCode key sessions to a cwd). Each project therefore has its own session list.

- **In the REPL:** `/resume` lists saved chats; `/resume <id>` (exact id, unique prefix, or title) loads one. `/name <title>` labels the current chat; `/reset` starts a new chat and saves the old one.
- **On launch:** `microdot.bat --resume <id>`.
- Chats are auto-titled from your first message and saved after each turn.

Resuming restores the **dialogue**; the worker, space and type stay as launched (the system prompt is rebuilt for the current worker).

## Context compaction
Long runs don't grow without bound. With `MICRODOT_COMPACT=true`:

- When the estimated context (`chars ÷ MICRODOT_CHARS_PER_TOKEN`) exceeds **`MICRODOT_CONTEXT_TOKENS`**, the **oldest messages are summarized** (a rolling summary) and replaced. Kept: the system prompt + the summary + the last **`MICRODOT_KEEP_RECENT`** messages. Tool‑call/result pairs are never split.
- Tool outputs larger than **`MICRODOT_OFFLOAD_TOKENS`** are written in full to `spaces/<worker>/notes/` and replaced in context by a short head **+ a pointer** — so nothing is lost.

Applies to the root agent **and every sub-agent**. Each compaction costs one extra (non‑streaming) model call; set `MICRODOT_SUMMARY_MODEL` to a cheaper model for those. The token counts are approximate (no local tokenizer), governed by the chars/token ratio.

## Self-cleanup
An agent tidies up after itself:

- **On exit** (including Ctrl+C) it **closes its tab**, releases its lease, and — if it was the **last** agent — **stops the shared Chromium** (one browser, started and stopped on demand). It also removes its **screenshots** (`spaces/<worker>/shots`) and the sub-agent scratch tree.
- **On start** it **sweeps orphaned tabs** left behind by crashed agents: tab leases live in `<engine>/.chromium-tabs`, and any page with no live owner is closed.
- Chats and spaces are **project data** and are always kept. Set `MICRODOT_KEEP_SHOTS=true` to keep screenshots too.

## Config (`.env`)
| var | default | meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | — | model key (falls back to `OpenRouterKey` env) |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible endpoint |
| `MICRODOT_MODEL` | `deepseek/deepseek-v4.1-flash` | model id |
| `MICRODOT_HEADLESS` | `true` | `false` = headful shared Chromium (tabs visible) |
| `MICRODOT_OPEN_SHOTS` | `true` | open screenshots in the default viewer |
| `MICRODOT_ISOLATE_AGENTS` | `false` | `true` = separate browser context per agent |
| `MICRODOT_CDP_URL` | `http://127.0.0.1:9222` | shared Chromium debug endpoint |
| `MICRODOT_VIEWPORT` | `1600x1000` | page/screenshot size (WIDTHxHEIGHT) |
| `MICRODOT_SHOT_QUALITY` | `80` | JPEG quality (1–100) |
| `MICRODOT_SHOT_SCALE` | `1` | device pixel ratio (`2` = crisper, larger images; isolate mode) |
| `MICRODOT_SHOT_FULLPAGE` | `false` | `true` = capture the whole page, not just the viewport |
| `MICRODOT_SHOT_KEEP` | `10` | keep only the newest N screenshots; older ones are deleted |
| `MICRODOT_HOME` | *(install dir)* | engine layer: where code + shipped defaults + Chromium profile live |
| `MICRODOT_TOOLS_DIR` | *(layered)* | explicit single dir for tools (else engine + project) |
| `MICRODOT_CHATS_DIR` | `.microdot/chats` | where chats are saved (relative to the launch dir) |
| `MICRODOT_LAUNCH_DIR` | *(set by launcher)* | the folder you launched from (project layer) |
| `MICRODOT_SKILLS_DIR` | *(layered)* | explicit single dir for skills (else engine + project) |
| `MICRODOT_WORKER_TYPES_DIR` | *(layered)* | explicit single dir for worker types (else engine + project) |
| `MICRODOT_WORKER_TYPE` | *(space)* | worker type for a new worker (else the space's, else `default`) |
| `MICRODOT_APPROVE_CREATE_TOOL` | `true` | ask before saving a tool whose code uses risky capabilities (child_process, require, direct fs/fetch, absolute paths, …) |
| `MICRODOT_ALLOW_SPAWN` | `false` | enable the `spawn_subagent` tool |
| `MICRODOT_MAX_DEPTH` | `3` | max sub-agent nesting depth |
| `MICRODOT_MAX_AGENTS` | `16` | max agents per run (whole tree) |
| `MICRODOT_MAX_CONCURRENT` | `8` | max sub-agents running at once |
| `MICRODOT_DEBUG` | `false` | keep sub-agent spaces + verbose logs |
| `PARALLEL_API_KEY` | — | optional; Parallel search key (anonymous free tier works without it) |
| `MICRODOT_TOOL_SANDBOX` | `none` | anything else = run tools in the isolated Linux worker (WSL on Windows, native on Linux) |
| `MICRODOT_SANDBOX_DIR` | — | advanced: explicit sandbox root; overrides `spaces/<worker>` |
| `MICRODOT_SPACE` | worker name | space to use (an agent can attach to a shared space) |
| `MICRODOT_MISSION` | — | initial `mission.md` text if the file doesn't exist |
| `MICRODOT_SANDBOX_BWRAP` | `false` | Linux: wrap the worker in `bubblewrap` (read-only root, only workspace writable) |
| `MICRODOT_WSL_DISTRO` | `Ubuntu-24.04` | WSL distro to use (Windows) |
| `MICRODOT_WSL_TIMEOUT_MS` | `60000` | per-call timeout (worker is killed on timeout) |
| `MICRODOT_NODE` | `node` | Node binary used to launch the worker (Linux) |
| `MICRODOT_CHROMIUM_ARGS` | — | extra Chromium flags (e.g. `--no-sandbox`) |
| `MICRODOT_TERMINAL` | `x-terminal-emulator` | terminal used by `/new` on Linux (outside tmux) |
| `MICRODOT_AGENT` | `main` | agent name for this CLI window |
| `MICRODOT_MAX_STEPS` | `12` | max tool-loop steps per turn |
| `MICRODOT_TEXT_LIMIT` | `32768` | max characters of a tool result fed to the model |
| `MICRODOT_TEXT_TOKENS` | — | if set, budget tool results in **tokens** instead (overrides `TEXT_LIMIT`) |
| `MICRODOT_CHARS_PER_TOKEN` | `4` | ratio used to convert the token budget to characters |
| `MICRODOT_COMPACT` | `false` | enable context compaction (trim + summarize) |
| `MICRODOT_CONTEXT_TOKENS` | `24000` | summarize when estimated context exceeds this |
| `MICRODOT_KEEP_RECENT` | `6` | recent messages kept verbatim during compaction |
| `MICRODOT_OFFLOAD_TOKENS` | `4000` | offload tool outputs larger than this to the space |
| `MICRODOT_SUMMARY_MODEL` | `qwen/qwen3.6-flash` | cheap model for summaries (falls back to `MICRODOT_MODEL`) |
| `MICRODOT_KEEP_SHOTS` | `false` | keep screenshots on exit (else removed) |
| `MICRODOT_VERBOSE` | `false` | show per-tool call/result lines (else a quiet scanner) |

## Notes
- Background actions are **quiet by default**: while the agent works it shows a KITT-style scanner (`─────o─────`, the `o` bouncing left↔right) with the current tool name, then clears it for the answer. Set `MICRODOT_VERBOSE=true` for the old per-tool `→`/`←` logging.
- Assistant replies are rendered as **coloured terminal markdown** (headings, bullets, bold/italic, inline code, fenced code blocks, links, rules, and **aligned box tables**).
- Screenshots are written to `spaces/<worker>/shots/` (per worker) at `MICRODOT_VIEWPORT` size (default 1600×1000).
- The shared Chromium uses a profile at `<engine>/.chromium-profile/` and is started/stopped automatically (see Self-cleanup); if you ever need to, end the `chrome`/`chrome.exe` process.
- Completely independent of the OpenDots app.


