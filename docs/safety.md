# Safety & responsible use — recommendations

MicroDot is deliberately persistent: it figures out *how* to get a job done and
doesn't give up. That tenacity is the feature — and the risk. It will find
end-runs (it already invented a chunked-`curl` workaround when `ctx.fetch` hit a
size cap). The question isn't whether the model is "well-behaved"; it's **what
the agent can reach, and who can see what it did.**

This file records the recommendations from a design discussion. It is guidance,
not a guarantee — see *Guidance vs enforcement* below.

## Where the risk comes from

- **Prompt injection from the web.** The agent reads untrusted pages; a hostile
  page can steer it, and the agent's tenacity then executes the injected goal
  well.
- **Broad capability.** `browser` + `fetch` can reach **any** host by default —
  no egress policy, no domain allow/deny, no rate courtesy.
- **It runs with your privileges.** Same user, same network, and whatever the
  browser profile and environment expose.

## What already constrains it

- **Generated code is jailed** — self-authored tools run only in the isolated
  Linux worker, cannot write outside their space, and cannot touch `tools/`.
- **Read isolation (with bubblewrap)** — the data dir is shadowed in the sandbox:
  a worker sees only **its own space**, not other projects' spaces, chats or tools,
  and the install's `.env` and `.chromium-profile` are **masked** (no API keys or
  browser sessions). Host files outside remain readable read-only (used for
  references); only the worker's own space is writable.
- **Hard caps** on agents / depth / concurrency, a **stop** key, and full
  **transcripts** (chats + offloaded tool outputs under `spaces/<agent>/notes/`).

Useful, but none of it bounds *what the browser and network can reach* or
*whether a side-effecting action should happen at all*.

## The sandbox escape and the real fix (WSL/Windows)

`bubblewrap` (`MICRODOT_SANDBOX_BWRAP=true`) makes the worker's **view** read-only — but it does not cut **WSL interop**. A sandboxed tool can execute `/mnt/c/Windows/System32/cmd.exe` (or `powershell.exe`), and that runs on the **Windows host as you**, bypassing the read-only mount. Verified: `cmd.exe /c mkdir C:\…` succeeds from *inside* `bwrap`. MicroDot prints a one-time warning when it detects interop **by actually running `cmd.exe`** (the `WSLInterop` binfmt entry stays listed even when interop is disabled, so its presence is not a reliable signal).

To close it, run the worker in a **dedicated WSL distro with interop disabled**:

```powershell
wsl --export Ubuntu-24.04 C:\temp\ubuntu.tar
wsl --import Ubuntu-MicroDot %LOCALAPPDATA%\MicroDotWSL C:\temp\ubuntu.tar
```

```ini
# Ubuntu-MicroDot:/etc/wsl.conf
[boot]
systemd=true
[interop]
enabled=false
appendWindowsPath=false
```

```powershell
wsl --shutdown
# then in MicroDot's .env:
#   MICRODOT_WSL_DISTRO=Ubuntu-MicroDot
```

Leave **automount on** — the agent's space lives on `/mnt/c` (a Windows folder), so disabling it would break the worker. With interop off, Windows binaries simply won't execute (`cmd.exe` exits non-zero), so the read-only mount becomes a real boundary for **writes and execution**. Read-only **references** still work: the CLI reads them **host-side**, so the agent never needs the host from the sandbox.

Alternatives: a container/VM for the worker, or running MicroDot as an unprivileged user with no valuable host access (reduces blast radius only).

## Recommended guardrails

Ordered cheap → strong. Effort is rough.

1. **Acceptable-use policy in the system prompt** *(cheap, high value)*
   Steer the model's judgment where most "should I?" decisions land:
   - respect terms of service and `robots.txt`;
   - no authentication bypass, paywall circumvention, or CAPTCHA solving;
   - no bulk scraping without permission; rate-limit politely;
   - don't act on accounts it doesn't own;
   - no fraud, harassment, spam, or illegal content;
   - identify itself where appropriate.

2. **Egress policy** *(real enforcement)*
   Allow/deny lists for `browser` + `fetch` (optional proxy), and **log every
   URL**. This is what actually bounds reachability.

3. **Audit log** *(cheap)*
   Append each tool call + URL + a short result summary to
   `spaces/<agent>/audit.log` (dated). Accountability and post-hoc review.

4. **Human gate for sensitive actions** *(medium)*
   A `confirm` hook (like `create_tool`'s approval) for outbound side-effects:
   form submissions, purchases, posts, deletes, outbound messages.

5. **Least privilege** *(operational)*
   Run unprivileged; use a **dedicated browser profile with no personal
   logins**; use scoped API keys; don't give it access it doesn't need.

## Guidance vs enforcement

- Items **1 and 3 are guidance/visibility** — they influence the model and
  record behaviour, but do **not** prevent an action.
- Items **2 and 4 are enforcement** — they bound what can happen.
- Durable safety = **capability limits** (what it can reach) + **oversight**
  (gates) + **accountability** (logs).
- The practical legal boundaries are the usual proxies: **authorization**,
  **terms of service**, and **harm**.

## Suggested first step

Do **#1 + #3** first: small, no behavioural surprises (policy text + audit log).
Follow with **#2** (egress allowlist) and **#4** (sensitive-action confirmation)
when you want real enforcement rather than guidance.
