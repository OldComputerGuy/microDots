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

A **persistent worker** is a named entity with:

- its own **space** (files it produces),
- its own **saved context** (a growing message history),
- a **worker type** (how it behaves) and a **mission** (what it owns),
- an **identity** (a name the main agent addresses it by).

The main agent creates it, assigns tasks by name, and it **keeps context between
assignments**. It is spawned by the agent, not the human.

```
spawn_worker({ name: "analyst", type: "researcher", mission: "own the NVDA thesis" })
assign_worker({ name: "analyst", task: "update on the latest earnings" })   → reply
```

## How it differs

| | context | lifetime | who drives it | who creates it |
|---|---|---|---|---|
| **sub-agent** | fresh, discarded | one task | parent, once | parent |
| **persistent worker** | kept, grows | standing | main agent, repeatedly | main agent |
| **`/new` window** | kept | standing | the human | the human |

The persistent worker is the missing third row: same lifecycle class as `/new`,
but agent-created and agent-driven.

## What already exists vs what's new

**Reused:** spaces, saved chats, worker types, context compaction, the spawner,
per-agent browser tabs.

**New:**
1. the main agent can **create and manage** a standing worker;
2. workers are **addressed by name** (send task → get reply);
3. a worker's context **survives** and is *not* cleaned up at end of turn/run.

## Interface (proposed)

| verb | effect |
|---|---|
| `spawn_worker({ name, type?, mission })` | create a standing worker (space + context + type + mission) |
| `assign_worker({ name, task })` | run the worker with its saved context; append; return its reply |
| `workers()` | list standing workers (name, type, mission, last activity) |
| `retire_worker({ name })` | archive a worker (reversible; not delete) |

A human-facing `/workers` could list / open / retire the same entities.

## Execution model

**On-demand, in-process (recommended).** The worker is reloaded with its saved
messages when assigned, runs synchronously (like a sub-agent run), returns a
result, and is compacted as needed. No idle process, no queue — consistent with
"one process, one Chromium".

**Rejected for now:** an always-on daemon per worker (background loops, IPC,
"is it busy?" state). Heavier, and against the small-server ethos. Revisit only
if a concrete background-work need appears.

## Storage (proposed)

```
<project>/.microdot/
  workers/
    <name>/
      state.json      # { name, type, mission, messages, createdAt, updatedAt }
      mission.md      # the worker's standing objective
      notes/ …        # its files (the space)
```

Open question: whether `state.json`'s messages live here or reuse the `chats/`
store with a `worker` marker (so they appear in `/resume`). Leaning: reuse
`chats/` for context (with a marker) and keep the space under `workers/<name>/`.

## Context policy

- Reuse the existing **compaction** (`MICRODOT_CONTEXT_TOKENS`, `MICRODOT_KEEP_RECENT`, summary model) so a long-lived worker stays bounded.
- Distinguish **transcript** (compacted, bounded) from **memory** (the worker's own durable files in its space — notes, memory.json, deliverables).
- Per-worker budget override is desirable; default to the project's.

## Caps, retirement, GC

Standing entities grow without bound, so these ship **with** the feature, not after:

- **`MICRODOT_MAX_WORKERS`** — a cap on standing workers (separate from `MAX_AGENTS`, which counts ephemeral sub-agents).
- **Retirement is archival, never deletion** — `retire_worker` moves a worker to an archive (mirroring the tool trash), restorable.
- **Self-review GC** — extend the tool-GC idea to workers: the agent occasionally asks *"is this worker still doing useful, distinct work?"* and retires the doubtful ones. Unsure → retire (reversible).

## Identity & safety

- Names unique per project; `assign_worker` resolves by name.
- A worker runs with the same sandbox/tool rules as any agent (space jailed; tools host-managed; browser tab on demand).
- Decide whether a worker may `spawn_subagent` / assign other workers (leaning: may spawn sub-agents; may not create workers, to avoid runaway fan-out — or gate behind a cap/depth rule).

## Relationship to existing pieces

- **Sub-agents stay ephemeral.** Do-this-once work keeps its cheap isolation; we do *not* make sub-agents persistent.
- **`/new` stays the human's window.** A persistent worker is the agent-facing equivalent.
- **Worker types** remain the reusable *role*; a worker is an *instance* bound to a role.
- Budget/caps, cleanup, and compaction all extend to workers.

## Open questions

1. Synchronous `assign` vs a background queue (start on-demand; revisit).
2. Does a worker hold a browser tab persistently, or open one per assignment?
3. May a worker spawn sub-agents? Assign other workers?
4. Memory model: transcript-only, or a curated memory file per worker?
5. Cost controls: per-worker turn/step budgets? Idle retirement after N days?
6. Human UX: `/workers` list/open/retire; does a worker appear in `/resume`?
7. Do workers count toward depth, or sit outside the agent tree?

## Non-goals (for now)

- A fleet of always-alive daemons; distributed/remote workers.
- Replacing sub-agents or making them persistent.
- Long-lived background loops / scheduling.

## Suggested first step

An **on-demand, in-process MVP**: `spawn_worker` / `assign_worker` / `workers` /
`retire_worker`, storing a worker as a space + a saved context, reusing
compaction, with a `MAX_WORKERS` cap and archival retirement. Prove continuity
on a real recurring task before adding daemons, queues, or worker-to-worker
assignment.
