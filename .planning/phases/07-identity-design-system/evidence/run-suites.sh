#!/usr/bin/env bash
# Phase 7 Plan 07, Task 2 — the full gate matrix, captured to one transcript.
#
#   bash .planning/phases/07-identity-design-system/evidence/run-suites.sh
#
# `bun test` is deliberately not used: Bun resolves that to its own built-in test
# runner, which ignores the workspace `test` scripts and runs every test file in the
# repository with the wrong setup. The root script is `bun run test`.
set -o pipefail

cd "$(dirname "$0")/../../../.." || exit 1
OUT=.planning/phases/07-identity-design-system/evidence/suites.txt
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
step bun run test
step bun run --filter admin build
# Electron Forge's package-manager check reads npm_config_user_agent, which Bun
# exports as `npm/undefined`; the override is environmental, not a code change.
echo "" >> "$OUT"
echo "### npm_config_user_agent=\"npm/11.16.0 node/v24.18.0 linux x64\" bun run --filter desktop package" >> "$OUT"
npm_config_user_agent="npm/11.16.0 node/v24.18.0 linux x64" \
  bun run --filter desktop package >> "$OUT" 2>&1
echo "(exit $?)" >> "$OUT"
step bun run --filter desktop test:e2e

echo "" >> "$OUT"
echo "### emitted CSS — brand declaration count" >> "$OUT"
{
  for file in admin/.output/public/assets/*.css; do
    echo "$file: $(grep -o -- '--brand:' "$file" | wc -l) --brand declaration(s), $(grep -o 'data:font/' "$file" | wc -l) inlined data: font(s)"
  done
  for file in desktop/.vite/renderer/main_window/assets/*.css; do
    echo "$file: $(grep -o -- '--brand:' "$file" | wc -l) --brand declaration(s), $(grep -o 'data:font/' "$file" | wc -l) inlined data: font(s)"
  done
} >> "$OUT" 2>&1
