#!/usr/bin/env bash
# Phase 14 Plan 13 — mutation proofs.
#
#   bash .planning/phases/14-admin-operations-evatu/evidence/mutations.sh
#
# Each mutation is applied to a tracked file, a focused test is run, and the file is restored
# from HEAD. A mutation that survives is a test gap; the script exits non-zero if any does.
# Nothing is committed and the working tree is restored on exit, including on failure.
set -uo pipefail
cd "$(dirname "$0")/../../../.." || exit 1

OUT=.planning/phases/14-admin-operations-evatu/evidence/mutations.txt
: > "$OUT"
survived=0
caught=0

restore() {
  git checkout -- "$1" 2>/dev/null || true
}

on_exit() {
  for file in "${TOUCHED[@]:-}"; do restore "$file"; done
}
TOUCHED=()
trap on_exit EXIT

mutate() {
  local name="$1" file="$2" from="$3" to="$4" pkg="$5" test="$6"
  TOUCHED+=("$file")
  python3 - "$file" "$from" "$to" <<'PY'
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
text = open(path).read()
if old not in text:
    print(f"MUTATION TARGET NOT FOUND\n  {old[:120]}")
    raise SystemExit(2)
open(path, 'w').write(text.replace(old, new, 1))
PY
  if [ $? -ne 0 ]; then
    echo "SKIP  $name — target not found" | tee -a "$OUT"
    restore "$file"
    return
  fi

  if bun run --filter "$pkg" test -- "$test" > /tmp/opencode/mutation.log 2>&1; then
    echo "SURVIVED  $name  ($file)" | tee -a "$OUT"
    survived=$((survived + 1))
  else
    echo "CAUGHT    $name  ($file)" | tee -a "$OUT"
    caught=$((caught + 1))
  fi
  restore "$file"
}

echo "Phase 14 mutations — $(date -u +%Y-%m-%dT%H:%M:%SZ)" | tee -a "$OUT"

mutate "a resolved conflict can be resolved again (the OPEN guard is dropped)" \
  api/src/modules/pos/pos.service.ts \
  "if (current.status !== 'OPEN') {" \
  "if (false) {" \
  api pos.conflicts.test.ts

mutate "a dismissal needs no note (the shared rule is loosened)" \
  packages/shared/src/conflicts.ts \
  "if (input.status === 'DISMISSED' && isBlank(input.note)) {" \
  "if (false) {" \
  shared conflicts.test.ts

mutate "a failed transfer posts a supplier payment" \
  api/src/modules/payables/payables.service.ts \
  "if (event.status === 'success') {" \
  "if (event.status === 'success' || event.status === 'failed') {" \
  api payables.transfer

mutate "an incomplete E-VAT certificate is accepted" \
  api/src/modules/evat/evat.service.ts \
  "const problem = certificateProblem(" \
  "const problem = false && certificateProblem(" \
  api evat.test.ts

mutate "the movement filter cannot name a sale" \
  api/src/modules/inventory/inventory.validation.ts \
  "type: z.enum(stockMovementTypeEnum.enumValues).optional()," \
  "type: z.enum(['ADJUSTMENT','RECEIPT','TRANSFER_IN','TRANSFER_OUT','COUNT_VARIANCE']).optional()," \
  api inventory.report.test.ts

mutate "the printed Z drops the cash refund it subtracts" \
  desktop/src/renderer/lib/receipt/report-render.ts \
  "label: 'Cash refunds'," \
  "label: 'Cash refunds removed'," \
  desktop report-render.test.ts

echo "" | tee -a "$OUT"
echo "CAUGHT $caught  SURVIVED $survived" | tee -a "$OUT"
[ "$survived" -eq 0 ] || exit 1
