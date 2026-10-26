#!/usr/bin/env bash
#
# Phase 11 — the whole gate matrix, in one transcript.
#
#   bash .planning/phases/11-procurement-replenishment/evidence/run-suites.sh
#
# Writes `suites.txt` beside this script. Every suite runs even after a failure, so one
# transcript names every red gate rather than stopping at the first. Requires the Docker
# Postgres (`docker compose up -d`) with `sceptre_drive_test` prepared.
set -uo pipefail

cd "$(dirname "$0")/../../../.." || exit 1
OUT=".planning/phases/11-procurement-replenishment/evidence/suites.txt"
: > "$OUT"

run() {
  local label="$1"
  shift
  echo "" >> "$OUT"
  echo "### $label" >> "$OUT"
  echo "\$ $*" >> "$OUT"
  "$@" >> "$OUT" 2>&1
  local status=$?
  echo "[exit $status]" >> "$OUT"
  return $status
}

FAILED=0
run "lint" bun run lint || FAILED=1
run "check-types" bun run check-types || FAILED=1
run "shared tests" bun run --filter @sceptre/shared test || FAILED=1
run "api tests" bun run --filter api test || FAILED=1
run "desktop tests" bun run --filter desktop test || FAILED=1
run "admin modules gate" bun run modules:check || FAILED=1
run "admin modules gate (strict)" bun run modules:check:strict || FAILED=1
run "brand gate" bun run brand:check || FAILED=1
run "token gate" bun run tokens:check || FAILED=1

echo "" >> "$OUT"
if [ "$FAILED" -eq 0 ]; then
  echo "ALL SUITES PASSED" >> "$OUT"
  echo "ALL SUITES PASSED"
else
  echo "ONE OR MORE SUITES FAILED — read the [exit N] lines above" >> "$OUT"
  echo "ONE OR MORE SUITES FAILED"
fi
exit "$FAILED"
