#!/usr/bin/env bash
# Phase 10 Plan 10 — the full gate matrix, captured to one transcript.
#
#   bash .planning/phases/10-desktop-pos-redesign/evidence/run-suites.sh
#
# `bun test` is deliberately not used: Bun resolves that to its own built-in test runner,
# which ignores the workspace `test` scripts and runs every test file with the wrong setup.
# The root script is `bun run test`. Run this with no browser suite in parallel — the API
# suite has produced a false 5 s timeout under load.
#
# The stack-dependent steps (counter audit, print smoke, shell E2E) are marked in the
# transcript, so a reader can tell an environment failure from a code failure.
set -o pipefail

cd "$(dirname "$0")/../../../.." || exit 1
OUT=.planning/phases/10-desktop-pos-redesign/evidence/suites.txt
: > "$OUT"

step() {
  echo "" >> "$OUT"
  echo "### $*" >> "$OUT"
  "$@" >> "$OUT" 2>&1
  echo "(exit $?)" >> "$OUT"
}

note() {
  local label="$1"
  shift
  echo "" >> "$OUT"
  echo "### $label" >> "$OUT"
  "$@" >> "$OUT" 2>&1
  echo "(exit $?)" >> "$OUT"
}

echo "captured $(date -u +%Y-%m-%dT%H:%M:%SZ) on $(uname -srm)" >> "$OUT"

# --- fast gates (no stack, no display) -------------------------------------------------------
step bun install
step bun run lint
step bun run check-types
step bun run brand:check
step bun run tokens:check
step bun run modules:check:strict
step bun run test
step bun run --filter admin build

# --- build -----------------------------------------------------------------------------------
# Electron Forge's package-manager check reads npm_config_user_agent, which Bun exports as
# `npm/undefined`; the override is environmental, not a code change.
echo "" >> "$OUT"
echo "### npm_config_user_agent=... bun run --filter desktop package" >> "$OUT"
npm_config_user_agent="npm/11.16.0 node/v24.18.0 linux x64" \
  bun run --filter desktop package >> "$OUT" 2>&1
echo "(exit $?)" >> "$OUT"

# --- stack-dependent gates -------------------------------------------------------------------
note "bun run --filter desktop test:e2e  [needs a display; packaged shell smoke]" \
  bun run --filter desktop test:e2e
note "bun run --filter desktop test:print  [needs the built app; fake ESC/POS adapter]" \
  bun run --filter desktop test:print
note "bun run --filter desktop test:counter  [needs API :4000, Postgres :5434, PowerSync :8080, demo seed]" \
  bun run --filter desktop test:counter

# --- gateway invariants ----------------------------------------------------------------------
echo "" >> "$OUT"
echo "### gateway invariants" >> "$OUT"
{
  echo "modules with a folder set (expect 14): $(find desktop/src/renderer/modules -mindepth 1 -maxdepth 1 -type d | wc -l)"
  echo "hash routes resolved by a module page: $(grep -c "case '" desktop/src/renderer/main.tsx)"
  echo "largest route file (lines): $(wc -l < desktop/src/renderer/routes/_pos/app.tsx)"
  echo "hover-only affordances on a counter surface (expect 0):"
  grep -rnE "group-hover|peer-hover" desktop/src/renderer/modules \
    desktop/src/renderer/components/layout desktop/src/renderer/components/common \
    | wc -l || true
  echo "hover-only classes in the generated registry (informational; the POS never renders Sidebar):"
  grep -rnE "group-hover|peer-hover" desktop/src/renderer/components/ui | wc -l || true
  echo "raw Tailwind palette classes outside the four diagnostic surfaces (expect 0):"
  grep -rnE "\b(bg|text|border|ring|outline|from|to|via|fill|stroke)-(amber|emerald|sky|red|zinc|neutral|stone|slate|gray|green|blue|yellow|orange|purple|pink|teal|indigo|violet|lime|cyan|fuchsia|rose)-[0-9]{2,3}\b" \
    desktop/src/renderer/modules desktop/src/renderer/components \
    | wc -l || true
  echo "toFixed( in renderer non-test sources (expect 0):"
  grep -rn "toFixed(" desktop/src/renderer --include='*.ts' --include='*.tsx' \
    | grep -v '\.test\.' | wc -l || true
  echo "averageBasketMinor definitions (expect 1, in packages/shared):"
  grep -rn "export function averageBasketMinor" packages/shared/src api/src desktop/src | wc -l || true
  echo "averageBasketMinor call sites (expect 5: four in analytics, one on the till):"
  # Comment lines mention the call by name; a doc reference is not a call site.
  grep -rn "averageBasketMinor(" packages/shared/src api/src desktop/src --include='*.ts' --include='*.tsx' \
    | grep -v '\.test\.' | grep -v "export function" \
    | grep -vE '^[^:]+:[0-9]+:[[:space:]]*(\*|/\*\*|//)' | wc -l || true
  echo "renderer bundle (main chunk bytes):"
  ls -l desktop/.vite/renderer/main_window/assets/index-*.js | awk '{print $5}'
  echo "counter-audit screenshots (expect 9):"
  ls .planning/phases/10-desktop-pos-redesign/evidence/shots/counter-*-1024.png | wc -l
} >> "$OUT" 2>&1
echo "(exit 0)" >> "$OUT"
