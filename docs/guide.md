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
- `/project /` (or picking *root* in the picker) returns to the root
  (no-project) layer — the generic space.
- MicroDot starts with **no project**. Select one with `/project` (picker) — it
  **resumes that project's latest chat**. (Set `MICRODOT_PROJECT` to force a
  project at startup.)

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
- `mission.md` is created on first run (seed it via `MICRODOT_MISSION`) and shown to the worker each session; edit it directly or with `/mission <text>`. `/mission /` resets to the **root mission** — for the root space it drops the override and regenerates the default, and for a worker space it copies the root space's mission down.
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

## Browser tools
The agent drives **its own tab** in the shared Chromium (started on demand). These builtins run on the host; sandboxed tools reach the same via `ctx.browser.*` (bridged back).

- `browser_open(url)` → `status`, `title`, `url`, visible `text`.
- `browser_text()` — the current tab's title + text.
- `browser_screenshot()` → JPEG saved to `spaces/<worker>/shots/` (kept newest `MICRODOT_SHOT_KEEP`) and attached to the conversation so the model can see it.
- `browser_click(selector)` / `browser_type(selector, text)` — interact with the page.
- `browser_scroll({ direction?, amount?, selector? })` — scroll `up`/`down`/`top`/`bottom` by `amount` px (default `600`), or scroll a `selector` into view; returns `{ scrollY, innerHeight, scrollHeight, atBottom, url }`.
- `browser_close()` — close your tab (the shared browser stays up for other agents).

## Skills (recipes)
MicroDot can save reusable **skills** — named markdown recipes/procedures (not code; that's `create_tool`). Engine skills live in `<install>/skills/`, project ones in `<project>/.microdot/skills/`.

- `save_skill(name, description, instructions)`, `list_skills()`, `read_skill(name)`, `delete_skill(name)`.
- At startup the available skills are listed in the system prompt, so MicroDot can `read_skill` one and follow it.

## Self-authored tools
MicroDot can **write its own tools** and use them immediately.

- Call **`create_tool`** with `name`, `description`, a JSON-Schema `parameters`, and the JS body of `async function run(args, ctx)`.
- The tool is registered live (callable in the **same** turn) and saved to the project layer (`<project>/.microdot/tools/<name>.mjs`).
- Saved tools **auto-load** at startup, so they persist across sessions.
- Manage them with **`list_tools`** (built-ins + your custom tools), **`delete_tool`** (removes the tool and its file), and **`copy_tool`** (copies a tool from one project to another — tools are per-project).
- In the **root** (no project active), `list_tools` / `/tools` also show **tools by project** — the engine's shared set, the root layer, and each named project, grouped by project name.
- Tools are saved **without asking** by default. Optionally set `MICRODOT_APPROVE_CREATE_TOOL=true` to be prompted (y/N) when a tool's code touches risky capabilities (`child_process`, `require`, dynamic `import`, direct `fs`/`fetch`, absolute paths, `process`, `eval`).
In the sandbox, `ctx` gives `agentId`, `fetch(url,opts)`, `log(...)`, `fs` (jailed to the worker's space), and `browser.*` (bridged to the host browser).

**Tool management model (important):**
- `tools/` is **host-managed**. The sandbox worker sees the project read-only, so a tool **cannot write or delete files in `tools/`** (it gets `EROFS`). This is deliberate — sandboxed code must not modify the tool set.
- The **single source of truth** is `<project>/.microdot/tools/<name>.mjs`, and it is edited **only** through `create_tool` (reuse a name to overwrite) / `delete_tool`. Don't hand-copy files into `tools/`; to move a tool between projects use the **`copy_tool`** builtin (host-managed).
- A file whose name starts with **`_`** is **parked**: it stays on disk but is **not loaded** (kept out of the model's tool list). Prefix throwaway probes with `_dbg_` (or delete them); rename to activate.
- Keep genuinely reusable helpers (e.g. probes you rely on) under a normal name; they'll load every session.

Example tool file (the `code` is the body of the async function; it runs only in the worker):
```js
export const definition = { type:'function', function:{ name:'slugify', description:'…', parameters:{ type:'object', properties:{ text:{type:'string'} }, required:['text'] } } };
export const code = "return { slug: String(args.text).toLowerCase().replace(/[^a-z0-9]+/g,'-') };";
```

## File references (read-only)

Point the agent at a file without loading it into context — it decides how much to consume, like a person: glance, search, page, read fully, or hand it to a sub-agent.

- **`/ref <path>`** (or drop a file into the prompt) registers it; **`/refs`** lists; **`/unref <path|all>`** removes. References are **saved with the chat** and restored by `/resume`.
- The agent sees only the paths (host + `/mnt/c/...` sandbox form), no sizes or line counts.
- Tools: **`reference_info`** (detect by content: text/PDF/image/archive/binary), **`read_reference`** (text: head by default; `query` to search, `offset`/`limit` to page, `all:true` only when truly needed), **`analyze_reference`** (run the analysis in a sub-agent so a large file never crowds the main context), **`view_reference`** (notes image viewability for text-only models).
- **Read-only**: originals are never written. With `MICRODOT_SANDBOX_BWRAP=true` the `/mnt/c` mount is read-only; without it, that isn't enforced.
- **Extraction is the agent's job**: for PDFs, images and archives it builds a tool with `create_tool` (e.g. `pdftotext`, OCR) and runs it in the sandbox. If it cannot extract a file, it says so rather than guessing.

## .workers (standing helpers)

A **.worker** is a standing, project-scoped agent the main agent spawns and consults — an ongoing-context specialist (an **expert**, **critic**, **personality**, or domain **owner**). Unlike a sub-agent (one-shot, fresh context), a .worker **keeps its context** between assignments and reports like a sub-agent.

- **Spawned by the agent**: `spawn_worker({ name, type?, mission })` — the name is dot-prefixed and functional (`.doc_search`, `.red_team`, `.nvda_analyst`).
- **Assign**: `assign_worker({ name, task })` — it runs in its own space (own browser tab), returns a **sub-agent-style report** (`report.md`/`report.json`), then waits.
- **Manage**: `workers()` lists them; `retire_worker({ name })` archives one (reversible). The human view is **`/workers`** (and `/workers retire <name>`).
- **Storage**: `<project>/.microdot/workers/.<name>/{context.json, mission.md, space/}` — hidden from `/project` (the dot prefix).
- **Project-scoped**: shares the project's tools / skills / worker-types; its own files live in its `space/`.
- **When to use one**: recurring work, or when remembered context or a distinct voice/perspective helps — otherwise use a one-off **sub-agent**. The default is ephemeral; the agent is told this in its system prompt.
- Cap: `MICRODOT_MAX_WORKERS` (default 12). Full design in [`persistent-workers.md`](persistent-workers.md).

## Tool garbage collectionOccasionally the agent reviews the tools **it built** and asks itself: *is this temporary? an old version? broken? still needed?* Doubtful tools go to a **reversible trash** — unsure → trash, never delete.

- **`/gc`** — inventory the tools (`gc_scan`), have the model decide keep / park / **trash** with a one-line reason, then apply and reload the tool list. It also runs automatically at end of run when there are obvious candidates (probe/`tmp_`/`dbg_`/parked/`experiment`/`deprecated`), unless `MICRODOT_GC=false`.
- **`/trash`** — list trashed tools; **`/trash restore <name>`** puts one back; **`/trash empty`** clears the trash. Nothing is auto-deleted.
- **Naming convention** (chosen by the model at `create_tool` time): `dbg_`/`tmp_` for throwaway tools, `_name` to **park** (kept on disk, not loaded), `name_v2` for iterations, and an optional **`status`** (`experiment` / `stable` / `deprecated`) stored as `// meta:` in the tool file.
- **Scope**: only agent-authored tools in the project/root layers — built-ins and the shipped `tools-custom/` are never touched.

## Tool sandbox backend
Self-authored tools run **only** in an isolated **Linux worker** (WSL on Windows, native on Linux) — there is no in-process/host path on any platform. If the worker can't start, custom tools are **refused**. One worker script, two launchers:

- **Windows:** the worker runs **inside WSL2** (spawned via `wsl.exe`). Requires Node in WSL: `wsl -- sudo apt-get install -y nodejs` (Node 18+ is enough).
- **Linux/VPS:** the worker runs **natively** — no WSL.
- **Confinement (`MICRODOT_SANDBOX_BWRAP=true`):** wrap the worker in `bubblewrap` - the system is mounted **read-only** and only the worker's space is writable (verified: writes to `/root` and `/etc` → `EROFS`). Needs `bubblewrap` installed. Network still works so `ctx.fetch` functions; reads of other paths remain. **Important — this is not a security boundary on Windows:** if **WSL interop** is enabled, a sandboxed tool can run `cmd.exe`/`powershell.exe`, which execute on the host **as you** and bypass the read-only mount entirely (MicroDot prints a one-time warning when it detects this). For a real boundary, run the worker in a **dedicated WSL distro with `[interop] enabled=false`** (keep automount — the agent's space lives on `/mnt/c`), or a container/VM — see [`safety.md`](safety.md). If `bubblewrap` is missing, MicroDot warns and **falls back to the unconfined worker**. The worker binds the active space read-write when it starts and **re-binds automatically when the active project/space changes** (e.g. a `/project` switch), so the new space stays writable.

There is **no sandbox mode switch and no fallback**: custom tools are sandboxed on every platform. Worker start has a timeout (`MICRODOT_SANDBOX_START_TIMEOUT_MS`); if it expires, the tool is refused.

In the sandbox:
- `ctx.fs` is jailed to the worker's space (`<project>/.microdot/spaces/<worker>/`); `ctx.fetch` runs natively in the worker; `ctx.browser.*` and `ctx.openPath` are **bridged back to the host** (shared Chromium / OS viewer).
- Tools get `ctx.browser.{open,text,url,screenshot,click,type,scroll,close}` + `ctx.fs` instead of `page()`/`host`/`import()`.

> With `bwrap` on, the system is read-only and only the space is writable; **without it - and even with it, if WSL interop is enabled - the sandbox is not a security boundary.** Fully closing it needs a dedicated WSL distro with `[interop] enabled=false` (keep automount - the space lives on `/mnt/c`) or a container/VM; see [`safety.md`](safety.md).

## Sub-agents
Sub-agents are **on by default**. A worker gets **`spawn_subagent({ mission, name?, type?, context?, deliverables? })`** and **`spawn_subagents({ tasks, concurrency? })`**: it designs tight, specialized missions and sub-agents run them autonomously — one at a time, or several **in parallel** (bounded by `MICRODOT_MAX_CONCURRENT`) — then report back. Disable with `MICRODOT_ALLOW_SPAWN=false`.

- **Nested spaces:** the child works in `<parent space>/subagents/<name>/` (siblings unique, auto-suffixed), so the filesystem mirrors the agent tree and names never clash.
- **Results roll up:** each child returns a **recursive digest** — `{ child, space, status, summary, findings, sources, artifacts, report_path, children[] }` — and writes `report.md`/`report.json` in its space. The root ends up with the whole tree's findings.
- **Caps (hard):** `MICRODOT_MAX_DEPTH` (3), `MICRODOT_MAX_AGENTS` (16, whole tree), `MICRODOT_MAX_CONCURRENT` (8). Over-limit spawns are denied without creating a folder.
- **Cleanup:** the sub-agent tree is scratch — removed at the end of the run. `MICRODOT_DEBUG=true` keeps it.
- **Per-agent tabs:** every agent gets its **own tab**, opened when it starts and closed when it finishes; the browser bridge is per-run, so parallel children never cross wires.

## Resuming chats
Every conversation is saved **per project** — under `<launch dir>/.microdot/chats/<id>.json`, where the launch dir is the folder you started MicroDot from (like Codex/OpenCode key sessions to a cwd).

- **In the REPL:** `/resume` lists saved chats; `/resume <id>` (exact id, unique prefix, or title) loads one. `/name <title>` labels the current chat; `/reset` starts a new chat and saves the old one. `/cls` clears the screen; `/clear` (or bare `clear`) clears the context and the screen (the old chat is saved).
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
| `MICRODOT_APPROVE_CREATE_TOOL` | `false` | prompt before saving a risky tool (off by default) |
| `MICRODOT_ALLOW_SPAWN` | `true` | sub-agents enabled |
| `MICRODOT_MAX_DEPTH` | `3` | max sub-agent nesting depth |
| `MICRODOT_MAX_AGENTS` | `16` | max agents per run (whole tree) |
| `MICRODOT_MAX_CONCURRENT` | `8` | max sub-agents running at once |
| `MICRODOT_DEBUG` | `false` | keep sub-agent spaces + verbose logs |
| `MICRODOT_DEBUG_INPUT` | `false` | log each raw input chunk (terminal / key debugging) |
| `MICRODOT_GC` | `true` | review/trash temporary tools at end of run when candidates exist |
| `MICRODOT_MAX_WORKERS` | `12` | max standing `.workers` per project |
| `PARALLEL_API_KEY` | — | optional Parallel search key (alias: `PARALLEL_KEY`) |
| `MICRODOT_SEARCH_MAX` | `0` | cap `web_search` calls per session (0 = unlimited); guards Parallel cost |
| `MICRODOT_SANDBOX_DIR` | - | explicit sandbox root override |
| `MICRODOT_SPACE` | worker name | space to use |
| `MICRODOT_MISSION` | — | initial `mission.md` text |
| `MICRODOT_SANDBOX_BWRAP` | `false` | wrap worker in bubblewrap (read-only root) |
| `MICRODOT_SANDBOX_START_TIMEOUT_MS` | `15000` | worker start timeout (then custom tools are refused) |
| `MICRODOT_WSL_DISTRO` | `Ubuntu-24.04` | WSL distro (Windows) |
| `MICRODOT_WSL_TIMEOUT_MS` | `60000` | per-call worker timeout |
| `MICRODOT_NODE` | `node` | Node binary for the worker (Linux) |
| `MICRODOT_CHROMIUM_ARGS` | — | extra Chromium flags |
| `MICRODOT_TERMINAL` | `x-terminal-emulator` | terminal for `/new` on Linux |
| `MICRODOT_AGENT` | `main` | agent name for this window |
| `MICRODOT_PROJECT` | — | current project name (else the launch folder / root layer) |
| `MICRODOT_PROJECT_DIR` | — | explicit project-layer dir override (advanced) |
| `MICRODOT_DATA_DIR` | `<install>/.microdot` | data dir (gitignored) |
| `MICRODOT_PROJECTS_DIR` | `<install>/.microdot/projects` | where named projects live |
| `MICRODOT_PRUNE_NOTES` | `true` | prune a space's `notes/` on exit |
| `MICRODOT_NOTES_KEEP` | `400` | keep the newest N note files |
| `MICRODOT_NOTES_MAX_MB` | `25` | notes size budget (MB) |
| `MICRODOT_EXIT_CONFIRM_MS` | `1000` | while a turn runs, Ctrl-C again within this window stops the system (idle Ctrl-C is ignored) |
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
- **Colour is automatic.** Output is colourised on a TTY and automatically **off** when piped/redirected or when `NO_COLOR` is set; `FORCE_COLOR=1` forces it on. The palette lives in `src/theme.mjs` (semantic roles: `ok`/`warn`/`err`, `label`, `project`, `engine`, `path`, `meta`).
- Background actions are **quiet by default**: a KITT-style scanner (`─────o─────`, the `o` bouncing) with the current tool name, cleared for the answer. `MICRODOT_VERBOSE=true` restores per-tool `→`/`←` lines.
- Replies render as **coloured terminal markdown** (headings, bullets, bold/italic, inline code, fenced code, links, rules, and **aligned box tables**).
- The shared Chromium uses `<engine>/.chromium-profile/` and is started/stopped automatically.
- Completely independent of the OpenDots app.
