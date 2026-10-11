# Security Policy

MicroDot is an early-stage project. **It is not production-hardened.** Please
read this before running it against anything you care about.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Instead, use
GitHub's private reporting:

1. Go to the **Security** tab of the repository.
2. Click **Report a vulnerability**.
3. Describe the issue, impact, and a minimal reproduction.

We'll acknowledge as quickly as we can and credit you in the fix unless you
prefer to stay anonymous.

## Things to know before you run it

- **The agent executes code.** Self-authored tools (`create_tool`) run in a
  Linux worker (WSL on Windows, native on Linux), optionally under
  `bubblewrap`. `MICRODOT_TOOL_SANDBOX=auto` falls back to **in-process**
  execution with a warning when no sandbox is available — in that fallback,
  generated code runs with your privileges. Use an explicit sandbox mode in
  untrusted settings.
- **Web content is untrusted input.** The agent browses and fetches pages; treat
  prompt-injection from fetched pages as a real risk. Don't give a Dot
  credentials or access it doesn't need.
- **Sub-agents are not sandboxed.** They run in-process and share the host
  browser and worker. They are bounded by the agent/depth/concurrency caps, not
  by a security boundary.
- **Secrets.** Keep keys in `.env` (gitignored) or the environment. Never commit
  them. See `.env.example` for the shape.
- **Browser profile.** The shared Chromium uses its own profile directory; it
  does not touch your everyday browser profile.

If you're deploying on a server, start from [`deploy/DEPLOY.md`](deploy/DEPLOY.md)
and run MicroDot as an unprivileged user with the agent caps lowered.
