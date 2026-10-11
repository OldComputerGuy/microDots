# Why I built MicroDot

*An origin story — the launch post. Cross-post to dev.to / Hashnode / your blog.*

---

Most "AI agent" projects I tried were heavier than the job.

They wanted a React front-end, a runtime server, a database, a Docker compose
file, or a full framework that re-implemented chat before it did anything
useful. I wanted the opposite: a tiny thing that **actually does work in a real
browser** and runs on the smallest box I own.

So I built **MicroDot** — *a Dot on a diet*.

## What it is

MicroDot is a small, self-hosted agent with its own browser tab. It researches
the web, drives a real Chromium page, writes its own tools, and spawns
sub-agents to parallelise a job — all in **one process with one shared
Chromium**, using plain files for state. No server. No database. No Docker.

It's MIT-licensed, written in plain Node, and it's both a CLI and a small
library.

## The design bets

A few decisions shaped everything:

**One process, one Chromium, one tab per agent.** Browsers are expensive. So
MicroDot starts a single Chromium on demand and attaches to it over CDP. Every
agent gets exactly one tab — created when the agent starts, never swapped, closed
when it's done. That keeps a fleet of agents cheap enough to run on a small VPS,
and it means the browser is a real, inspectable thing rather than a headless
abstraction hidden in a framework.

**The agent extends itself.** It can write new tools (`create_tool`) — run in a
Linux sandbox worker, with approval gated to risky patterns — and it can spawn
sub-agents (`spawn_subagent`, `spawn_subagents`) that fan out in parallel,
write to nested spaces, and roll their findings back up the tree. Caps are hard:
agents, depth, and concurrency are bounded so a runaway agent can't eat the box.

**Plain-file state.** Chats, spaces, worker types, skills, and custom tools are
just files. You can read them, diff them, back them up with `cp`. There's nothing
to migrate and no service to keep alive.

**Quiet by default.** The UI is a KITT-style scanner. Set `MICRODOT_VERBOSE=true`
when you want every tool call on screen.

**It's a library first.** The CLI is a test harness. The real surface is
`createRuntime()`:

```js
import { createRuntime } from 'microdot';

const rt = await createRuntime({ browser: 'on-demand', compact: true });
const dot = await rt.dot('analyst', { type: 'researcher', mission: 'track NVDA' });
const text = await dot.run('summarise the latest earnings', {
  onToken: (t) => process.stdout.write(t),
});
await rt.close();
```

## What it isn't

It isn't a chat wrapper, and it isn't production-hardened yet — the repo says
**"working, but in progress"** and means it. Generated code runs in your
privileges if no sandbox is available. Sub-agents share the host. Treat web
content as untrusted. Read the [security notes](../SECURITY.md).

## Why now

Small models got good and cheap enough that a lean tool-loop agent is
genuinely useful without a giant framework behind it. The interesting question
isn't "how do I chat with a model" anymore — it's "how do I let a small agent
*do things* on my behalf, safely and cheaply?" MicroDot is my answer, and it's
deliberately small enough to read in an afternoon.

If that's your kind of thing:

- Repo: <https://github.com/OldComputerGuy/microDots>
- Start here: [`docs/guide.md`](../guide.md)
- Roadmap and `good first issue`s welcome.
