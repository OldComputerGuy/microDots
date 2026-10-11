# MicroDot Roadmap

MicroDot is **working, but in progress**. This is a rough, living list — order
and scope will change. Items marked **help wanted** are good places to jump in.

## Now (0.1.x) — hardening the core

- **Tests** — first automated coverage: spawner caps/budget, compaction/offload,
  chat persistence. *help wanted*
- **Async-iterator API** — `dot.run()` currently streams via `onToken`/`onTool`
  callbacks; add an `async iterable` of `{ type: 'text' | 'tool' | 'done' }`
  events for library users.
- **Provider flexibility** — keep OpenRouter as the default, but make the
  OpenAI-compatible base URL a first-class, documented option. *help wanted*
- **Docs** — a real quickstart tutorial and a "write your own tool" guide.

## Next (0.2) — reach & ergonomics

- **Web app / TUI** — an optional thin front-end over `createRuntime()`; the CLI
  stays the minimal harness.
- **Better skills & worker types** — more examples, and `/skills` discoverability.
- **Structured run reports** — a stable JSON run log (agents, tools, timings,
  cost) for scripting and benchmarking.
- **Observability** — token/cost accounting surfaced in the CLI and the library.

## Later (0.3+) — scale & ecosystem

- **Plugin surface** — a documented way to register tools, worker types, and
  providers from a separate package.
- **Multi-provider routing** — pick models per worker type (cheap model for
  summarising, strong model for reasoning).
- **Distributed workers** — optional remote sandbox workers for heavier tools.

## Non-goals

- No CopilotKit, React, server, DB, or Docker in the core.
- No browser framework or bundler.
- Not a chat wrapper: the point is **doing things in a real browser** with tools,
  memory and sub-agents.

## How to help

See [`CONTRIBUTING.md](CONTRIBUTING.md). Issues labelled `good first issue` are
scoped to be approachable.
