#!/usr/bin/env bash
# MicroDot launcher (Linux / VPS). Mirror of microdot.bat.
set -euo pipefail
cd "$(dirname "$(readlink -f "$0")")"

# Prefer fnm/nvm Node 20+ if available; otherwise use whatever is on PATH.
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)" 2>/dev/null || true
  fnm use --silent-if-missing 24 >/dev/null 2>&1 || true
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[MicroDot] Node.js was not found. Install Node 20+ (e.g. fnm/nvm or apt)." >&2
  exit 1
fi

echo "[MicroDot] Node: $(node --version)"

# Pass any arguments through, e.g.  ./microdot.sh --prompt "open example.com"
exec node --env-file-if-exists=.env src/cli.mjs "$@"
