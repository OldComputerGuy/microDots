# .workers — design

> **Status: implemented (MVP).** The on-demand design below is live —
> `spawn_worker` / `assign_worker` / `workers` / `retire_worker`, project-scoped,
> dot-named `.workers` under `workers/.<name>/`, with archival retirement.
> Deferred items are listed under **Decisions**.

## Why

MicroDot has three ways to run agent work today:

- the **main agent** (one per CLI window) — persistent, but you only get one;
- **sub-agents** (`spawn_subagent`) — a *role you invoke*; fresh context, runs once, then the instance is gone;
- **`/new`** — a *human* opens another CLI window (its own agent + space + saved chats).

What's missing is a **.worker the main agent can spawn and keep**, with its own
**ongoing context**, that it hands work to over time. Not a role, not a window
you open by hand — a standing peer the main agent creates and drives.

## Core idea

A **.worker** is a named, **project-scoped** entity with:

- its own **context** (a growing message history, saved and resumed),
- a **space** to work in,
- the project's **worker types / skills / tools** (shared),
- a **mission** (what it owns),
- an **identity**: a dot-prefixed, function-named directory — `.doc_search`
  (not generic numbered names).

The main agent creates it, assigns tasks by name, and it **keeps context between
assignments**. It is spawned by the agent, not the human.

```
spawn_worker({ name: ".nvda_analyst", type: "researcher", mission: "own the NVDA thesis" })
assign_worker({ name: ".nvda_analyst", task: "update on the latest earnings" })   → reply
```

## How it differs

| | context | lifetime | who drives it | who creates it |
|---|---|---|---|---|
| **sub-agent** | fresh, discarded | one task | parent, once | parent |
| **.worker** | kept, grows | standing | main agent, repeatedly | main agent |
| **`/new` window** | kept | standing | the human | the human |

The .worker is the missing third row: same lifecycle class as `/new`, but
agent-created and agent-driven.

## How you use one

A .worker is something you **consult**, on demand, repeatedly:

1. **Ask** — the main agent sends a task or question (`assign_worker`).
2. **Work** — the .worker runs in its own kept context (+ the project's tools), like a sub-agent run.
3. **Report** — it returns a **sub-agent-style report** (summary + findings + artifacts/sources), written to its space (`report.md` / `report.json`) and handed back to the main agent.
4. **Wait** — it goes idle, and is reloaded with its saved context on the next assignment.

"Waiting" is **metaphorical**: there is no live process. Between assignments a .worker is just files on disk — it costs nothing until the next ask. So a .worker is a **consulted expert** as much as a standing owner: *ask → answer → idle → ask again*.

## Roles

A .worker is a standing identity; *what it does* is set by its **worker type**. Useful archetypes:

- **Owner** — a domain specialist that accumulates knowledge and owns an ongoing objective (`.nvda_analyst`, `.market_scan`).
- **Expert** — a standing specialist you consult on demand (`.tax_expert`, `.sec_expert`, `.doc_search`). Ask a question or assign a task; it answers and reports; it waits for the next one.
- **Critic** — an independent reviewer with its own standards and memory, used to challenge the main agent's work (`.red_team`, `.editor`, `.skeptic`).
  - A **persistent critic** gives *consistent* review (it remembers prior critiques and standards).
  - For *truly independent* review, use a **fresh sub-agent** instead — a standing critic can anchor on its own past.
- **Personality** — a consistent voice/character (tone, values, style) for repeated output (`.brand_editor`, `.optimist`). Several can form a panel (optimist + skeptic + editor).

The same machinery serves all of these: a name, a worker type (the persona/behaviour), a mission, and a kept context.

## When it makes sense to use a .worker

The system should decide this **per task, conservatively**. Create a .worker only when several of these hold:

1. **Recurrence** — the task/domain will come up again.
2. **Continuity** — remembering prior work changes the outcome (not just repeating it).
3. **Identity** — a distinct, consistent voice/perspective is wanted (personalities, critics).
4. **Independence** — a viewpoint separate from the main agent's context is valuable (critics).
5. **Worth a standing entity** — the value exceeds the cost (growing context, compaction, GC).

If none hold → use a **sub-agent** (one-off, parallel, throwaway) or just do it inline.

**Default is ephemeral.** Mint .workers deliberately, and retire them when the domain goes cold. The guidance for this ("when to spawn a .worker") should live *somewhere the model reads it* — a line in the system prompt and/or a playbook skill — not be implied.

## Lifecycle: promote / demote / retire

- **Promote** — if a one-off sub-agent's work keeps recurring, turn it into a .worker, carrying its findings into the new .worker's starting context. (ephemeral → standing)
- **Retire** — archive a .worker when its domain is done (`retire_worker`), reversible. (standing → archived)
- This is what keeps standing entities from piling up (the same concern the tool-GC guards against).

## Scoping & naming

- **Project-scoped.** A .worker belongs to a project and lives inside it. It is
  not a top-level project.
- **Dot-named, by function.** `.doc_search`, `.pdf_extract`, `.nvda_analyst`,
  `.market_scan`. The leading dot is the hidden marker; the rest says what the
  .worker does.
- **Hidden from `/project`.** `listProjects()` already ignores dot-prefixed
  names, so .workers never appear in the user's project list. They are surfaced
  through a dedicated `/workers` view instead.
- **Attached to a project**, sharing its layer (worker types / skills / tools)
  and its storage root — so a .worker inherits the project's tooling and its
  context lives alongside the project's data.

## What already exists vs what's new

**Reused:** spaces, saved chats, worker types, context compaction, the spawner,
per-agent browser tabs, the project layer.

**New:**
1. the main agent can **create and manage** a .worker;
2. .workers are **addressed by name** (send task → get reply);
3. a .worker's context **survives** and is *not* cleaned up at end of turn/run.

## Storage (proposed)

```
<project>/.microdot/
  spaces/main/                 ← the main agent
  workers/
    .doc_search/               ← a .worker (dot = hidden)
      context.json             ← { name, type, mission, messages, createdAt, updatedAt }
      mission.md
      space/                   ← the .worker's files (its ctx.fs root)
    .pdf_extract/
  tools/ skills/ worker-types/ ← shared with the project
```

A .worker is attached to the project and **shares the project's layer** (tools /
skills / worker-types), but keeps its **own sub-area** — `workers/.<name>/space/`
— so its files never collide with the main agent's space. The `mission.md` and
`context.json` sit next to that space (outside it), so the .worker can't clobber
its own state while working.

## Execution model

**On-demand, in-process (recommended).** When assigned, a .worker is reloaded
with its saved context, runs synchronously (like a sub-agent run), returns a
result, and is compacted as needed. No idle process, no queue — consistent with
"one process, one Chromium".

Because a .worker is **project-scoped and shares the project's layer**, there is
**no active-project switch**: it runs exactly like a sub-agent (explicit space,
shared layer). This is the main reason to prefer project-scoped over top-level
.workers. A tab is opened for the assignment and closed when the .worker reports.

**Rejected for now:** an always-on daemon per .worker (background loops, IPC,
"is it busy?" state). Heavier, and against the small-server ethos.

## Interface (proposed)

| verb | effect |
|---|---|
| `spawn_worker({ name, type?, mission })` | create a standing .worker (name is dot-prefixed, function-named) |
| `assign_worker({ name, task })` | run the .worker with its saved context; append; return its reply |
| `workers()` | list standing .workers (name, type, mission, last activity) |
| `retire_worker({ name })` | archive a .worker (reversible; not delete) |

A human-facing **`/workers`** lists / opens / retires the same entities; the main
agent drives them via the verbs above.

## Context policy

- Reuse the existing **compaction** (`MICRODOT_CONTEXT_TOKENS`, `MICRODOT_KEEP_RECENT`, summary model) so a long-lived .worker stays bounded.
- Distinguish **transcript** (compacted, bounded) from **memory** (the .worker's own durable files — notes, deliverables).
- Per-.worker budget override is desirable; default to the project's.

## Caps, retirement, GC

Standing entities grow without bound, so these ship **with** the feature, not after:

- **`MICRODOT_MAX_WORKERS`** — a cap on standing .workers (separate from `MAX_AGENTS`, which counts ephemeral sub-agents).
- **Retirement is archival, never deletion** — `retire_worker` moves a .worker to an archive (mirroring the tool trash), restorable.
- **Self-review GC** — extend the tool-GC idea to .workers: the agent occasionally asks *"is this .worker still doing useful, distinct work?"* and retires the doubtful ones. Unsure → retire (reversible).

## Identity & safety

- Names are dot-prefixed and unique per project; `assign_worker` resolves by name.
- A .worker runs with the same sandbox/tool rules as any agent (space jailed; tools host-managed; browser tab on demand).
- Decide whether a .worker may `spawn_subagent` / create further .workers: **may spawn sub-agents; may not create .workers** (that is reserved for the main agent, to prevent runaway fan-out).

## Decisions (locked)

1. **Own sub-area.** Each .worker keeps its files under `workers/.<name>/space/`; it shares the project's **layer**, not the main agent's space.
2. **On-demand, synchronous.** `assign_worker` runs the .worker in-process to completion and returns; no queue, no daemon.
3. **Tab per assignment.** A .worker opens a browser tab for an assignment and closes it when it reports (same as a sub-agent).
4. **May spawn sub-agents; may not create .workers** (see above).
5. **Transcript + memory.** The kept, compacted message transcript is the context; durable knowledge lives in the .worker's own files in its space.
6. **Reports reuse the sub-agent digest schema** — `summary / findings / sources / artifacts / report_path`, with `report.md` + `report.json` in its space — so the main agent handles sub-agent and .worker replies uniformly.
7. **Outside the agent tree.** .workers don't count toward `MAX_DEPTH`/`MAX_AGENTS`; they are bounded by `MICRODOT_MAX_WORKERS`.
8. **Human view: `/workers`.** .workers stay hidden from `/project` and are *not* listed in `/resume`; `/workers` lists / opens / retires them.
9. **"When to use" guidance lives in the system prompt** (a short policy, using the criteria above); a playbook skill can be added later.
10. **Retirement is archival** — `retire_worker` moves the .worker to an archive (reversible; never a delete).

**Deferred:** always-on daemons; idle auto-retirement; cross-project .workers; .worker-to-.worker assignment; library (`createRuntime`) wiring.

## Relationship to existing pieces

- **Sub-agents stay ephemeral.** Do-this-once work keeps its cheap isolation; we do *not* make sub-agents persistent.
- **`/new` stays the human's window.** A .worker is the agent-facing equivalent.
- **Worker types** remain the reusable *role*; a .worker is an *instance* bound to a role.
- Budget/caps, cleanup, compaction, and the tool-GC all extend to .workers.

## Open questions

_(All resolved — see **Decisions (locked)** above.)_

## Non-goals (for now)

- **Global, cross-project .workers** (spanning projects) — project-scoped only for now.
- A fleet of always-alive daemons; distributed/remote workers.
- Replacing sub-agents or making them persistent.
- Long-lived background loops / scheduling.

## Suggested first step

An **on-demand, in-process MVP**: `spawn_worker` / `assign_worker` / `workers` /
`retire_worker`, storing each .worker as `workers/.<name>/context.json` inside the
project, sharing the project layer, reusing compaction, with a `MAX_WORKERS` cap
and archival retirement. Prove continuity on a real recurring task before adding
daemons, queues, or .worker-to-.worker assignment.
