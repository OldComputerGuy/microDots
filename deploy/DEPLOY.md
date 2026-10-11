# MicroDot — deployment on a small server

MicroDot is deliberately lean: **no server, no DB, no Docker, no framework**. One
Node process, one shared Chromium (started on demand, stopped when the last agent
exits), and plain files for state. This keeps an idle box quiet and caps a busy turn.

Adjust the numbers below to your box — they are sane defaults, not measurements.

## 1. Install (minimal)

```sh
# Node 20+ (fnm/nvm or distro). Playwright's Chromium needs the system libs:
npm ci --omit=dev
npx playwright install --with-deps chromium      # system deps + browser
cp .env.example .env
```

Only real dependency is Playwright (used as the CDP client + Chromium launcher).

## 2. `.env` for a small server

```ini
MICRODOT_HEADLESS=true
MICRODOT_OPEN_SHOTS=false
MICRODOT_KEEP_SHOTS=false
MICRODOT_VERBOSE=false
MICRODOT_TOOL_SANDBOX=sandbox        # native Linux worker (add MICRODOT_SANDBOX_BWRAP=true + bubblewrap for a jail)
MICRODOT_COMPACT=true                # keep context/token cost low
MICRODOT_KEEP_RECENT=6
MICRODOT_OFFLOAD_TOKENS=4000
# Lean Chromium for small boxes:
MICRODOT_CHROMIUM_ARGS=--disable-gpu --disable-dev-shm-usage --renderer-process-limit=1 --disable-extensions --mute-audio
```

Notes:
- **Idle ≈ nothing**: MicroDot stops the shared Chromium when the last agent exits
  and starts it on the next run, so a scheduled Dot pays browser start only while it runs.
- `MICRODOT_CHROMIUM_ARGS` above trims GPU/shm/renderer overhead. `--single-process`
  is *not* recommended (unstable).
- Set a **`MICRODOT_SUMMARY_MODEL`** to a cheap model (default `qwen/qwen3.6-flash`) so
  compaction never uses the expensive model.

## 3. Resource caps (systemd)

Cap the whole unit — Node + Chromium + the tool worker share these:

```ini
MemoryMax=768M
MemoryHigh=640M
CPUQuota=150%
TasksMax=256
```

If the tool worker runs under bubblewrap, add cgroup limits there too, or rely on
the unit caps (simpler).

## 4. Running modes

MicroDot is a CLI. On servers you run it headless in one of three ways:

**a) Interactive** — in `tmux` (survives SSH drops), then `/new`, `/resume`, etc.
```sh
tmux new -s dots 'cd /opt/microdot && ./microdot.sh'
```

**b) One-shot** (a Dot runs a task and exits):
```sh
cd /opt/microdot && ./microdot.sh --prompt-file tasks/daily.md
```

**c) Scheduled** (a "daily Dot") — systemd service + timer, see `deploy/`.

## 5. State layout on the server

- **Engine layer** (`/opt/microdot`): code, shipped worker-types/skills/tools, the
  shared Chromium profile, `.env`.
- **Project layer** (the folder you launch from, e.g. `/srv/dots/.microdot`): `chats/`,
  `spaces/<worker>/`, and any project tools/skills/worker-types. Self-ignoring
  (`.gitignore` = `*`), so it never lands in a repo.

Run each Dot from its own project dir to keep its space/chats separate.

## 6. Updating & cleanup

```sh
git pull && npm ci --omit=dev && npx playwright install chromium
```
Tabs left by a crash are swept on the next start; screenshots are removed on exit;
sub-agent scratch is removed at the end of a run.
