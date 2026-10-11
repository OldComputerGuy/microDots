# MicroDot

> **Status: working, but in progress** — early and moving fast; expect changing config, tools and layout. **Not production-hardened.**

**A Dot on a diet** — a bare-bones, **self-extending** agent built to run on small servers. No CopilotKit, no React, no server, no DB, no Docker.

- **Builds its own tools** — `create_tool` (sandboxed, pattern-gated) + `list_tools` / `delete_tool`.
- **Delegates to itself** — `spawn_subagent` / `spawn_subagents`: recursive, parallel, nested spaces, roll-up, hard caps.
- **One process, one Chromium** — a tab per agent; started on demand and stopped when idle.
- **Plain-file state** — chats, spaces, worker types, skills, tools. No services to run.

Each CLI window is its own agent sharing that one Chromium.

## Quick start
```sh
npm install
npx playwright install chromium        # Linux/VPS: npx playwright install --with-deps chromium
cp .env.example .env                   # Windows: copy .env.example .env
# set OPENROUTER_API_KEY in .env, or rely on an OpenRouterKey env var
```

```sh
microdot.bat                            # Windows: interactive CLI (agent "main")
./microdot.sh                           # Linux/VPS
microdot.bat --prompt "summarise https://example.com"
microdot.bat --prompt-file task.md      # read a multi-line prompt from a file
microdot.bat --resume <id>              # resume a saved chat
```

## Commands
| command | effect |
|---|---|
| `/new [name] [type]` | open a new worker (own CLI + space + type) |
| `/paste` | paste a multi-line prompt (finish with a line containing only `.`) |
| `/resume [id]` | list saved chats, or resume one |
| `/name [title]` | show or set this chat's title |
| `/tools`, `/delete <n>` | list / delete custom tools |
| `/skills` | list saved skills |
| `/type [name]` | show or set this worker's type |
| `/mission [text]` | show or set this space's `mission.md` |
| `/reset`, `/shots`, `/help`, `/exit` | |

## Docs
- **[docs/guide.md](docs/guide.md)** — architecture, spaces & layers, tools, sub-agents, the sandbox, compaction, cleanup, and the full config reference.
- **[deploy/DEPLOY.md](deploy/DEPLOY.md)** — small-server deploy: systemd unit + timer, lean Chromium flags, resource caps.
- **[LICENSE](LICENSE)** — MIT.
