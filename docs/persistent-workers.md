# Persistent workers — design

> **Status: design only, not implemented.** This document captures the concept
> before any code. It builds on the existing sub-agent / worker-type / space /
> chat machinery; nothing here changes today's behaviour.

## Why

MicroDot has three ways to run agent work today:

- the **main agent** (one per CLI window) — persistent, but you only get one;
- **sub-agents** (`spawn_subagent`) — a *role you invoke*; fresh context, runs once, then the instance is gone;
- **`/new`** — a *human* opens another CLI window (its own agent + space + saved chats).

What's missing is a **worker the main agent can spawn and keep**, with its own
**ongoing context**, that it hands work to over time. Not a role, not a window
you open by hand — a standing peer the main agent creates and drives.

## Core idea

A **persistent worker** is a named, **project-scoped** entity with:

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
| **persistent worker** | kept, grows | standing | main agent, repeatedly | main agent |
| **`/new` window** | kept | standing | the human | the human |

The persistent worker is the missing third row: same lifecycle class as `/new`,
but agent-created and agent-driven.

## Scoping & naming

- **Project-scoped.** A worker belongs to a project and lives inside it. A worker
  is not a top-level project.
- **Dot-named, by function.** `.doc_search`, `.pdf_extract`, `.nvda_analyst`,
  `.market_scan`. The leading dot is the hidden marker; the rest says what the
  worker does.
- **Hidden from `/project`.** `listProjects()` already ignores dot-prefixed
  names, so workers never appear in the user's project list. They are surfaced
  through a dedicated `/workers` view instead.
- **Attached to a project**, sharing its layer (worker types / skills / tools)
  and its storage root — so a worker inherits the project's tooling and its
  context lives alongside the project's data.

## What already exists vs what's new

**Reused:** spaces, saved chats, worker types, context compaction, the spawner,
per-agent browser tabs, the project layer.

**New:**
1. the main agent can **create and manage** a standing worker;
2. workers are **addressed by name** (send task → get reply);
3. a worker's context **survives** and is *not* cleaned up at end of turn/run.

## Storage (proposed)

```
<project>/.microdot/
  spaces/main/                 ← the main agent
  workers/
    .doc_search/               ← a worker (dot = hidden)
      context.json             ← { name, type, mission, messages, createdAt, updatedAt }
      ...                       ← files it works on / produces
    .pdf_extract/
  tools/ skills/ worker-types/ ← shared with the project
```

A worker is attached to the project and **shares the project's layer and
workspace**; its own directory holds its context and its working files. (Whether
a worker shares the project's *main* space or keeps its own sub-area is an open
question — see below; the recommended default is its own sub-area, to avoid file
collisions with the main agent.)

## Execution model

**On-demand, in-process (recommended).** When assigned, a worker is reloaded
with its saved context, runs synchronously (like a sub-agent run), returns a
result, and is compacted as needed. No idle process, no queue — consistent with
"one process, one Chromium".

Because a worker is **project-scoped and shares the project's layer**, there is
**no active-project switch**: it runs exactly like a sub-agent (explicit space,
shared layer). This is the main reason to prefer project-scoped over top-level
workers.

**Rejected for now:** an always-on daemon per worker (background loops, IPC,
"is it busy?" state). Heavier, and against the small-server ethos.

## Interface (proposed)

| verb | effect |
|---|---|
| `spawn_worker({ name, type?, mission })` | create a standing worker (name is dot-prefixed, function-named) |
| `assign_worker({ name, task })` | run the worker with its saved context; append; return its reply |
| `workers()` | list standing workers (name, type, mission, last activity) |
| `retire_worker({ name })` | archive a worker (reversible; not delete) |

A human-facing **`/workers`** lists / opens / retires the same entities; the main
agent drives them via the verbs above.

## Context policy

- Reuse the existing **compaction** (`MICRODOT_CONTEXT_TOKENS`, `MICRODOT_KEEP_RECENT`, summary model) so a long-lived worker stays bounded.
- Distinguish **transcript** (compacted, bounded) from **memory** (the worker's own durable files — notes, deliverables).
- Per-worker budget override is desirable; default to the project's.

## Caps, retirement, GC

Standing entities grow without bound, so these ship **with** the feature, not after:

- **`MICRODOT_MAX_WORKERS`** — a cap on standing workers (separate from `MAX_AGENTS`, which counts ephemeral sub-agents).
- **Retirement is archival, never deletion** — `retire_worker` moves a worker to an archive (mirroring the tool trash), restorable.
- **Self-review GC** — extend the tool-GC idea to workers: the agent occasionally asks *"is this worker still doing useful, distinct work?"* and retires the doubtful ones. Unsure → retire (reversible).

## Identity & safety

- Names are dot-prefixed and unique per project; `assign_worker` resolves by name.
- A worker runs with the same sandbox/tool rules as any agent (space jailed; tools host-managed; browser tab on demand).
- Decide whether a worker may `spawn_subagent` / create further workers (leaning: may spawn sub-agents; may **not** create workers, to avoid runaway fan-out — or gate behind a cap).

## Relationship to existing pieces

- **Sub-agents stay ephemeral.** Do-this-once work keeps its cheap isolation; we do *not* make sub-agents persistent.
- **`/new` stays the human's window.** A persistent worker is the agent-facing equivalent.
- **Worker types** remain the reusable *role*; a worker is an *instance* bound to a role.
- Budget/caps, cleanup, compaction, and the tool-GC all extend to workers.

## Open questions

1. **Share the main space, or its own sub-area?** Recommendation: own sub-area (`workers/.<name>/`) to avoid collisions; confirm.
2. Synchronous `assign` vs a background queue (start on-demand; revisit).
3. Does a worker hold a browser tab persistently, or open one per assignment?
4. May a worker spawn sub-agents? Create further workers?
5. Memory model: transcript-only, or a curated memory file per worker?
6. Cost controls: per-worker turn/step budgets? Idle retirement after N days?
7. Human UX: `/workers` list/open/retire; do workers show in `/resume`?
8. Do workers count toward depth, or sit outside the agent tree?

## Non-goals (for now)

- **Global, cross-project workers** (a worker spanning projects) — project-scoped only for now.
- A fleet of always-alive daemons; distributed/remote workers.
- Replacing sub-agents or making them persistent.
- Long-lived background loops / scheduling.

## Suggested first step

An **on-demand, in-process MVP**: `spawn_worker` / `assign_worker` / `workers` /
`retire_worker`, storing each worker as `workers/.<name>/context.json` inside the
project, sharing the project layer, reusing compaction, with a `MAX_WORKERS` cap
and archival retirement. Prove continuity on a real recurring task before adding
daemons, queues, or worker-to-worker assignment.
