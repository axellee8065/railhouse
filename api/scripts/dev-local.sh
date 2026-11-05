#!/usr/bin/env bash
# Run the sandbox from a local-disk mirror when the Project store is FUSE-backed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIRROR="${CASINO_RAIL_MIRROR:-/tmp/casino-rail-api}"

mkdir -p "$MIRROR"
rsync -a --delete --exclude node_modules --exclude package-lock.json "$ROOT/" "$MIRROR/"
cd "$MIRROR"
if [[ ! -x node_modules/.bin/tsx ]]; then
  npm install --no-audit --no-fund
fi
exec npm run dev
