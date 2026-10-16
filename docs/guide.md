# MicroDot — guide

Deep-dive docs. Start with the [README](../README.md); small-server deploy is in
[`deploy/DEPLOY.md`](../deploy/DEPLOY.md).

## Library / API
```js
import { createRuntime } from 'microdot';

const rt = await createRuntime({ apiKey, dataDir: '/srv/dots', browser: 'on-demand', compact: true });
rt.registerTool({ name, description, parameters, run: async (args, ctx) => { /* … */ } });

const dot = await rt.dot('analyst', { type: 'researcher', mission: 'track NVDA' });
const text = await dot.run('summarise the latest earnings', { onToken, onTool });

await rt.close();
```

- `createRuntime(options)` owns the heavy resources **once** — one Chromium (on demand) + one sandbox worker — so `dot(...)` is cheap.
- `browser`: `'off'` (no Chromium; `web_search`/`web_fetch`/tools only) · `'on-demand'` (default) · `'always'`.
- `dot(name, { type, mission })` → `{ name, space, type, messages, run(task, {onToken, onTool}), reset() }`. `run` streams and resolves to the final text.
- `rt.registerTool({ name, description, parameters, run })` adds an **app-owned host tool** (runs in-process with `ctx`).
- Sub-agents, self-authored tools, spaces, chats and compaction all work exactly as in the CLI.
- Every option falls back to the matching `MICRODOT_*` env var; the **CLI is a thin test harness** over this same core.

## Projects

A **project** is a named workspace — a logical container for chats, spaces,
missions, notes and project-specific tools — **not** a folder you navigate. It's
the natural unit when you use one agent for different jobs (per client, topic or
experiment) without shuffling directories.

- `/project` shows the current project and lists the others.
- `/project <name>` **loads and resumes** it (its latest chat + its space).
- `/project new <name>` creates a **clean** project and switches to it.
- `/project delete <name>` removes one (not the current).
- `/project off` returns to the launch folder.
- The current project is remembered across launches (a `.current` pointer under
  the projects root), so a restart drops you back where you were.

Storage still lives on disk (`<projectsRoot>/<name>/`), but you only ever refer
to it by name. With no project set, MicroDot keeps the legacy layout
`<launchDir>/.microdot`. Project-layer tools/skills/worker-types still override
the engine's shipped ones. See the env table for `MICRODOT_PROJECT`,
`MICRODOT_PROJECTS_DIR` and the notes-prune knobs.

## Architecture
- The first MicroDot CLI **launches one Chromium** (persistent, headless or headful) exposing CDP; every other agent connects to it.
- Each CLI process is **one agent** and works in its **own tab**.
- `/new` opens a **new CLI window** (a new agent) attached to the same Chromium.
- Closing an agent closes only its tab; the shared Chromium is stopped automatically when the **last** agent exits.

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

- **Engine** — the install dir (where the code lives, override with `MICRODOT_HOME`). Holds the **shared Chromium profile**, the **shipped worker-types/skills/tools** (e.g. `default`, `researcher`), and the engine-level `tools-custom/`.
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

- The anonymous tier is **rate-limited** and search is **metered (~$1 / 1000 searches)**. Results are **cached in-process**, so repeated identical queries are free; `429`/rate-limit responses are retried with backoff, and if they persist you get a clear error suggesting `PARALLEL_API_KEY`.
- Cap searches per session with `MICRODOT_SEARCH_MAX` (0 = unlimited) to keep cost bounded.

- `web_search(query, objective?)` → `{ query, count, results: [{ title, url, publish_date, excerpt }] }` — for current information, news, docs, comparisons.
- `web_fetch(urls, objective?)` → the extracted content of specific pages — when you need exact wording, quotes, or full-page analysis.
- Both are **builtins**, so they run on the host even in sandbox mode. Prefer them over opening a search engine in the browser (which gets blocked).

## Skills (recipes)
MicroDot can save reusable **skills** — named markdown recipes/procedures (not code; that's `create_tool`). Engine skills live in `<install>/skills/`, project ones in `<project>/.microdot/skills/`.

- `save_skill(name, description, instructions)`, `list_skills()`, `read_skill(name)`, `delete_skill(name)`.
- At startup the available skills are listed in the system prompt, so MicroDot can `read_skill` one and follow it.

## Self-authored tools
MicroDot can **write its own tools** and use them immediately.

- Call **`create_tool`** with `name`, `description`, a JSON-Schema `parameters`, and the JS body of `async function run(args, ctx)`.
- The tool is registered live (callable in the **same** turn) and saved to the project layer (`<project>/.microdot/tools/<name>.mjs`).
- Saved tools **auto-load** at startup, so they persist across sessions.
- Manage them with **`list_tools`** (built-ins + your custom tools) and **`delete_tool`** (removes the tool and its file).
- **Approval is pattern-gated:** harmless tools are saved silently; a tool whose code touches risky capabilities (`child_process`, `require`, dynamic `import`, direct `fs`/`fetch`, absolute paths, `process`, `eval`) prompts for y/N first. Disable with `MICRODOT_APPROVE_CREATE_TOOL=false`.
- In-process `ctx` gives `page()`, `agentId`, `clip`, `textLimit`, `host`, plus `fetch` and dynamic `import`.

Example tool file:
```js
export const definition = { type:'function', function:{ name:'slugify', description:'…', parameters:{ type:'object', properties:{ text:{type:'string'} }, required:['text'] } } };
export const code = "return { slug: String(args.text).toLowerCase().replace(/[^a-z0-9]+/g,'-') };";
export async function run(args, ctx) {
  return { slug: String(args.text).toLowerCase().replace(/[^a-z0-9]+/g,'-') };
}
```

## Tool sandbox backend
By default (`MICRODOT_TOOL_SANDBOX=auto`) self-authored tools run in an isolated **Linux worker** (WSL on Windows, native on Linux) and fall back to in-process only if it can't start. One worker script, two launchers:

- **Windows:** the worker runs **inside WSL2** (spawned via `wsl.exe`). Requires Node in WSL: `wsl -- sudo apt-get install -y nodejs` (Node 18+ is enough).
- **Linux/VPS:** the worker runs **natively** — no WSL.
- **Confinement (`MICRODOT_SANDBOX_BWRAP=true`):** wrap the worker in `bubblewrap` — the system is mounted **read-only** and only the worker's space is writable (verified: writes to `/root` and `/etc` → `EROFS`). Needs `bubblewrap` installed. Network still works so `ctx.fetch` functions; reads of other paths remain, and Windows interop isn't fully closed. If `bubblewrap` is missing, MicroDot warns and **falls back to the unconfined worker**.

Modes: `auto` (default) = sandbox when available else in-process; `none` = always in-process (full local privileges); `wsl`/`sandbox` = always sandbox (no fallback). The worker start has a timeout (`MICRODOT_SANDBOX_START_TIMEOUT_MS`).

In the sandbox:
- `ctx.fs` is jailed to the worker's space (`<project>/.microdot/spaces/<worker>/`); `ctx.fetch` runs natively in the worker; `ctx.browser.*` and `ctx.openPath` are **bridged back to the host** (shared Chromium / OS viewer).
- Tools get `ctx.browser.{open,text,url,screenshot,click,type,close}` + `ctx.fs` instead of `page()`/`host`/`import()`.

> With `bwrap` on, the system is read-only and only the space is writable; without it, WSL mode is functional-but-loose. Fully closing interop/reads needs a dedicated distro.

## Sub-agents
Sub-agents are **on by default**. A worker gets **`spawn_subagent({ mission, name?, type?, context?, deliverables? })`** and **`spawn_subagents({ tasks, concurrency? })`**: it designs tight, specialized missions and sub-agents run them autonomously — one at a time, or several **in parallel** (bounded by `MICRODOT_MAX_CONCURRENT`) — then report back. Disable with `MICRODOT_ALLOW_SPAWN=false`.

- **Nested spaces:** the child works in `<parent space>/subagents/<name>/` (siblings unique, auto-suffixed), so the filesystem mirrors the agent tree and names never clash.
- **Results roll up:** each child returns a **recursive digest** — `{ child, space, status, summary, findings, sources, artifacts, report_path, children[] }` — and writes `report.md`/`report.json` in its space. The root ends up with the whole tree's findings.
- **Caps (hard):** `MICRODOT_MAX_DEPTH` (3), `MICRODOT_MAX_AGENTS` (16, whole tree), `MICRODOT_MAX_CONCURRENT` (8). Over-limit spawns are denied without creating a folder.
- **Cleanup:** the sub-agent tree is scratch — removed at the end of the run. `MICRODOT_DEBUG=true` keeps it.
- **Per-agent tabs:** every agent gets its **own tab**, opened when it starts and closed when it finishes; the browser bridge is per-run, so parallel children never cross wires.

## Resuming chats
Every conversation is saved **per project** — under `<launch dir>/.microdot/chats/<id>.json`, where the launch dir is the folder you started MicroDot from (like Codex/OpenCode key sessions to a cwd).

- **In the REPL:** `/resume` lists saved chats; `/resume <id>` (exact id, unique prefix, or title) loads one. `/name <title>` labels the current chat; `/reset` starts a new chat and saves the old one.
- **On launch:** `microdot.bat --resume <id>`.
- Chats are auto-titled from your first message and saved after each turn. Resuming restores the **dialogue**; the worker/space/type stay as launched.

## Context compaction
Long runs don't grow without bound. With `MICRODOT_COMPACT=true`:

- When the estimated context (`chars ÷ MICRODOT_CHARS_PER_TOKEN`) exceeds **`MICRODOT_CONTEXT_TOKENS`**, the **oldest messages are summarized** (a rolling summary) and replaced. Kept: the system prompt + the summary + the last **`MICRODOT_KEEP_RECENT`** messages. Tool-call/result pairs are never split.
- Tool outputs larger than **`MICRODOT_OFFLOAD_TOKENS`** are written in full to `spaces/<worker>/notes/` and replaced in context by a short head **+ a pointer** — so nothing is lost.

Applies to the root agent **and every sub-agent**. Each compaction costs one extra (non-streaming) model call; set `MICRODOT_SUMMARY_MODEL` to a cheaper model. Token counts are approximate (no local tokenizer).

## Self-cleanup
- **On exit** (including Ctrl+C) an agent **closes its tab**, releases its lease, and — if it was the **last** agent — **stops the shared Chromium**. It also removes its **screenshots** (`spaces/<worker>/shots`) and the sub-agent scratch tree.
- **On start** it **sweeps orphaned tabs** left behind by crashed agents (leases live in `<engine>/.chromium-tabs`; any page with no live owner is closed).
- Chats and spaces are **project data** and are always kept. `MICRODOT_KEEP_SHOTS=true` keeps screenshots too.

## Running on a Linux VPS
Content is largely ported to the [deploy guide](../deploy/DEPLOY.md). In short:

- `npm ci --omit=dev` + `npx playwright install --with-deps chromium`; set `MICRODOT_HEADLESS=true` and `MICRODOT_OPEN_SHOTS=false` (no display).
- Launch with `./microdot.sh`; run several agents as separate processes (or `tmux` windows) — they share the one Chromium over CDP. `/new` uses `tmux` inside tmux, else a terminal, else a detached process.
- The shared Chromium binds to **localhost** (`MICRODOT_CDP_URL`); never expose that port.
- As **root**, Chromium needs `--no-sandbox` (MicroDot adds it automatically on Linux root; override with `MICRODOT_CHROMIUM_ARGS`).
- For a real sandbox use `bubblewrap` (`MICRODOT_SANDBOX_BWRAP=true`) or a container.

## Config
| var | default | meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | — | model key (falls back to `OpenRouterKey` env) |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | OpenAI-compatible endpoint |
| `MICRODOT_MODEL` | `deepseek/deepseek-v4.1-flash` | model id |
| `MICRODOT_HEADLESS` | `true` | `false` = headful shared Chromium |
| `MICRODOT_OPEN_SHOTS` | `true` | open screenshots in the default viewer |
| `MICRODOT_ISOLATE_AGENTS` | `false` | `true` = separate browser context per agent |
| `MICRODOT_CDP_URL` | `http://127.0.0.1:9222` | shared Chromium debug endpoint |
| `MICRODOT_VIEWPORT` | `1600x1000` | page/screenshot size |
| `MICRODOT_SHOT_QUALITY` | `80` | JPEG quality (1–100) |
| `MICRODOT_SHOT_SCALE` | `1` | device pixel ratio (isolate mode) |
| `MICRODOT_SHOT_FULLPAGE` | `false` | `true` = capture the whole page |
| `MICRODOT_SHOT_KEEP` | `10` | keep newest N screenshots |
| `MICRODOT_KEEP_SHOTS` | `false` | keep screenshots on exit |
| `MICRODOT_HOME` | *(install dir)* | engine layer dir |
| `MICRODOT_TOOLS_DIR` | *(layered)* | explicit single dir for tools |
| `MICRODOT_CHATS_DIR` | `.microdot/chats` | chats dir (rel. to launch dir) |
| `MICRODOT_LAUNCH_DIR` | *(set by launcher)* | project layer (= cwd) |
| `MICRODOT_SKILLS_DIR` | *(layered)* | explicit single dir for skills |
| `MICRODOT_WORKER_TYPES_DIR` | *(layered)* | explicit single dir for worker types |
| `MICRODOT_WORKER_TYPE` | *(space)* | worker type for a new worker |
| `MICRODOT_APPROVE_CREATE_TOOL` | `true` | pattern-gated approval before saving a risky tool |
| `MICRODOT_ALLOW_SPAWN` | `true` | sub-agents enabled |
| `MICRODOT_MAX_DEPTH` | `3` | max sub-agent nesting depth |
| `MICRODOT_MAX_AGENTS` | `16` | max agents per run (whole tree) |
| `MICRODOT_MAX_CONCURRENT` | `8` | max sub-agents running at once |
| `MICRODOT_DEBUG` | `false` | keep sub-agent spaces + verbose logs |
| `PARALLEL_API_KEY` | - | optional Parallel search key |
| `MICRODOT_SEARCH_MAX` | `0` | cap `web_search` calls per session (0 = unlimited); guards Parallel cost |
| `MICRODOT_TOOL_SANDBOX` | `auto` | `auto` / `none` / `wsl` / `sandbox` |
| `MICRODOT_SANDBOX_DIR` | — | explicit sandbox root override |
| `MICRODOT_SPACE` | worker name | space to use |
| `MICRODOT_MISSION` | — | initial `mission.md` text |
| `MICRODOT_SANDBOX_BWRAP` | `false` | wrap worker in bubblewrap (read-only root) |
| `MICRODOT_SANDBOX_START_TIMEOUT_MS` | `15000` | worker start timeout (then fallback) |
| `MICRODOT_WSL_DISTRO` | `Ubuntu-24.04` | WSL distro (Windows) |
| `MICRODOT_WSL_TIMEOUT_MS` | `60000` | per-call worker timeout |
| `MICRODOT_NODE` | `node` | Node binary for the worker (Linux) |
| `MICRODOT_CHROMIUM_ARGS` | — | extra Chromium flags |
| `MICRODOT_TERMINAL` | `x-terminal-emulator` | terminal for `/new` on Linux |
| `MICRODOT_AGENT` | `main` | agent name for this window |
| `MICRODOT_PROJECT` | — | current project name (else the launch folder) |
| `MICRODOT_DATA_DIR` | `<install>/.microdot` | data dir (gitignored) |
| `MICRODOT_PROJECTS_DIR` | `<install>/.microdot/projects` | where named projects live |
| `MICRODOT_PRUNE_NOTES` | `true` | prune a space's `notes/` on exit |
| `MICRODOT_NOTES_KEEP` | `400` | keep the newest N note files |
| `MICRODOT_NOTES_MAX_MB` | `25` | notes size budget (MB) |
| `MICRODOT_EXIT_CONFIRM_MS` | `1000` | Ctrl-C again within this window stops the system (first press only warns) |
| `MICRODOT_MAX_STEPS` | `12` | max tool-loop steps per turn |
| `MICRODOT_TEXT_LIMIT` | `32768` | max chars of a tool result fed to the model |
| `MICRODOT_TEXT_TOKENS` | — | budget tool results in tokens instead |
| `MICRODOT_CHARS_PER_TOKEN` | `4` | ratio for token↔char conversion |
| `MICRODOT_COMPACT` | `false` | enable context compaction |
| `MICRODOT_CONTEXT_TOKENS` | `24000` | summarize when estimated context exceeds this |
| `MICRODOT_KEEP_RECENT` | `6` | recent messages kept during compaction |
| `MICRODOT_OFFLOAD_TOKENS` | `4000` | offload larger tool outputs to the space |
| `MICRODOT_SUMMARY_MODEL` | `qwen/qwen3.6-flash` | cheap summarizer model |
| `MICRODOT_SUMMARY_TIMEOUT_MS` | `30000` | summarizer call timeout |
| `MICRODOT_VERBOSE` | `false` | show per-tool lines (else the scanner) |

## Notes
- Background actions are **quiet by default**: a KITT-style scanner (`─────o─────`, the `o` bouncing) with the current tool name, cleared for the answer. `MICRODOT_VERBOSE=true` restores per-tool `→`/`←` lines.
- Replies render as **coloured terminal markdown** (headings, bullets, bold/italic, inline code, fenced code, links, rules, and **aligned box tables**).
- The shared Chromium uses `<engine>/.chromium-profile/` and is started/stopped automatically.
- Completely independent of the OpenDots app.
