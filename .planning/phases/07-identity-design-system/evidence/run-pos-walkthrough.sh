#!/usr/bin/env bash
# Runs the POS walkthrough with its own admin dev server, so the server's lifetime is the
# run's lifetime. Leaves nothing behind.
set -uo pipefail
cd "$(dirname "$0")/../../../.." || exit 1

PORT=3001
LOG=/tmp/opencode/admin-dev-walkthrough.log

bun run --filter admin dev -- --port "$PORT" --strictPort > "$LOG" 2>&1 &
SERVER=$!
trap 'kill "$SERVER" 2>/dev/null' EXIT

for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/login")
  [ "$code" = "200" ] && break
  sleep 2
done

if [ "$code" != "200" ]; then
  echo "admin dev server did not come up; see $LOG"
  exit 2
fi

# No fixture reset: each run creates its own terminal, so the shift document number for the
# day is used once and nothing has to be deleted from the ledger.

ADMIN_URL="http://localhost:$PORT" node .planning/phases/07-identity-design-system/evidence/walkthrough-pos.mjs
