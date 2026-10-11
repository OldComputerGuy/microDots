# Contributing to MicroDot

Thanks for taking a look. MicroDot is early and moving fast — the most useful
contributions right now are **bug reports, docs fixes, and small, focused PRs.**

## Ground rules

- Be kind. See [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- Keep the core **lean**: no React, no CopilotKit, no server, no DB, no Docker.
  If a change needs one of those to work, it probably belongs in a plugin or a
  separate project.
- One feature per PR. Small diffs get reviewed; giant ones stall.
- Don't commit secrets. `.env` is gitignored — only `.env.example` is tracked.

## What we'd love help with

- **Docs**: clearer quickstart, tutorials, better examples.
- **Worker types & skills**: new `worker-types/*.md` and skills are easy wins.
- **Provider support**: MicroDot talks OpenRouter today; other OpenAI-compatible
  endpoints are welcome (keep the shape of `src/agent.mjs`).
- **Tests**: there is no automated test suite yet. A small one around
  `src/spawner.mjs` (caps/budget) and compaction would be very welcome.
- **Best-in-class reports**: repro steps, OS, Node version, and the exact command.

## What we'd rather you didn't do (yet)

- Large refactors or renames without an issue first.
- Adding runtime dependencies without discussing it.
- Anything that pulls in a browser framework, bundler, or service.

## Dev setup

```sh
git clone https://github.com/OldComputerGuy/microDots.git
cd microDots
npm install
npx playwright install chromium        # Linux/VPS: --with-deps chromium
cp .env.example .env                   # Windows: copy .env.example .env
# put OPENROUTER_API_KEY in .env (or rely on an OpenRouterKey env var)
```

Run the agent:

```sh
node --env-file-if-exists=.env src/cli.mjs --prompt "Reply with exactly: hello"
```

Run the library example:

```sh
node --env-file-if-exists=.env examples/run-dot.mjs
```

## Checklist before you open a PR

- [ ] `node --check src/*.mjs` passes for every file you touched.
- [ ] The CLI still answers a trivial prompt (`--prompt "Reply with exactly: ok"`).
- [ ] `examples/run-dot.mjs` still runs (if you touched the library).
- [ ] No secrets, no `.env`, no `node_modules` in the diff.
- [ ] README stays short; put detail in `docs/`.

## Commit style

Short imperative subject line, optional body explaining the *why*. Example:

```
Cap concurrent sub-agents at MICRODOT_MAX_CONCURRENT

The parallel fan-out ignored the cap when tasks arrived in bursts. Reserve
budget synchronously before spawning so a batch can't overspend.
```

## Review

Maintainers aim to respond to issues and PRs quickly. If a PR goes quiet for a
week, a polite ping in the thread is welcome.
