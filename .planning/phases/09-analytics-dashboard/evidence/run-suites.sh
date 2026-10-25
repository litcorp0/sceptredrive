#!/usr/bin/env bash
# Phase 9 Plan 08 — the full gate matrix, captured to one transcript.
#
#   bash .planning/phases/09-analytics-dashboard/evidence/run-suites.sh
#
# `bun test` is deliberately not used: Bun resolves that to its own built-in test runner,
# which ignores the workspace `test` scripts and runs every test file with the wrong setup.
# The root script is `bun run test`. Run this with no browser suite in parallel — the API
# suite has produced a false 5 s timeout under load.
set -o pipefail

cd "$(dirname "$0")/../../../.." || exit 1
OUT=.planning/phases/09-analytics-dashboard/evidence/suites.txt
: > "$OUT"

step() {
  echo "" >> "$OUT"
  echo "### $*" >> "$OUT"
  "$@" >> "$OUT" 2>&1
  echo "(exit $?)" >> "$OUT"
}

echo "captured $(date -u +%Y-%m-%dT%H:%M:%SZ) on $(uname -srm)" >> "$OUT"

step bun install
step bun run lint
step bun run check-types
step bun run brand:check
step bun run tokens:check
step bun run modules:check:strict
step bun run test
step bun run --filter admin build

# Electron Forge's package-manager check reads npm_config_user_agent, which Bun exports as
# `npm/undefined`; the override is environmental, not a code change.
echo "" >> "$OUT"
echo "### npm_config_user_agent=... bun run --filter desktop package" >> "$OUT"
npm_config_user_agent="npm/11.16.0 node/v24.18.0 linux x64" \
  bun run --filter desktop package >> "$OUT" 2>&1
echo "(exit $?)" >> "$OUT"

echo "" >> "$OUT"
echo "### bun run --filter admin test:walkthrough (needs the API, admin dev server, demo sales)" >> "$OUT"
bun run --filter admin test:walkthrough >> "$OUT" 2>&1
echo "(exit $?)" >> "$OUT"

echo "" >> "$OUT"
echo "### gateway invariants" >> "$OUT"
{
  echo "chart tokens in :root: $(grep -c -- '--chart-' packages/brand/src/tokens.css)"
  echo "analytics endpoints mounted: $(grep -c "analyticsRoutes\.\(get\|post\)" api/src/modules/analytics/analytics.routes.ts)"
  echo "client money arithmetic in the analytics module (expect 0):"
  grep -rnE "parseFloat|toFixed|/ 100" admin/src/modules/analytics --include='*.ts*' | grep -v 'format-chart' | wc -l
} >> "$OUT" 2>&1
