#!/usr/bin/env bash
#
# Phase 12 — mutation proofs.
#
# Each mutation is applied to the product code, the narrow suite that must catch it is run,
# the failure is recorded, and the file is restored. A mutation that fails nothing is a gap
# in the tests, not a pass. Writes `mutations.txt` beside this script.
#
#   bash .planning/phases/12-branch-ops-approvals/evidence/mutations.sh
set -uo pipefail

cd "$(dirname "$0")/../../../.." || exit 1
OUT=".planning/phases/12-branch-ops-approvals/evidence/mutations.txt"
: > "$OUT"

CAUGHT=0
MISSED=0

mutate() {
  local n="$1" file="$2" from="$3" to="$4" dir="$5" test="$6" label="$7"
  echo "" >> "$OUT"
  echo "### Mutation $n — $label" >> "$OUT"
  echo "file: $file" >> "$OUT"
  echo "  - $from" >> "$OUT"
  echo "  + $to" >> "$OUT"

  python3 - "$file" "$from" "$to" <<'PY' >> "$OUT" 2>&1 || { echo "[mutation could not be applied]" >> "$OUT"; MISSED=$((MISSED+1)); return; }
import sys
path, old, new = sys.argv[1], sys.argv[2], sys.argv[3]
src = open(path).read()
if old not in src:
    print("ANCHOR NOT FOUND")
    sys.exit(2)
if src.count(old) != 1:
    print(f"ANCHOR NOT UNIQUE ({src.count(old)})")
    sys.exit(2)
open(path, "w").write(src.replace(old, new))
print("applied")
PY

  if ! grep -q "^applied$" <(tail -1 "$OUT"); then
    echo "RESULT: NOT APPLIED (treated as a missed proof)" >> "$OUT"
    git checkout -- "$file"
    MISSED=$((MISSED+1))
    return
  fi

  echo "\$ (cd $dir && bunx vitest run $test)" >> "$OUT"
  ( cd "$dir" && bunx vitest run "$test" ) >> "$OUT" 2>&1
  local status=$?
  echo "[exit $status]" >> "$OUT"

  git checkout -- "$file"

  if [ "$status" -ne 0 ]; then
    echo "RESULT: CAUGHT by $test" >> "$OUT"
    CAUGHT=$((CAUGHT+1))
  else
    echo "RESULT: **MISSED** — the suite passed against a broken rule" >> "$OUT"
    MISSED=$((MISSED+1))
  fi
}

mutate 1 "packages/shared/src/pricing.ts" \
  "  return scaledDelta <= allowance" \
  "  return scaledDelta < allowance" \
  "packages/shared" "src/pricing.test.ts" \
  "withinPriceBand is inclusive at the edge (<= becomes <)"

mutate 2 "packages/shared/src/approvals.ts" \
  "  if (user.label === approval.requestedBy) return false" \
  "  // removed: self-approval check" \
  "packages/shared" "src/approvals.test.ts" \
  "nobody approves their own request (self-approval check removed)"

mutate 3 "packages/shared/src/approvals.ts" \
  "    approval.deciderRole === 'MANAGER' &&
    approval.deciderBranchId !== null &&
    user.branchId === approval.deciderBranchId" \
  "    approval.deciderRole === 'MANAGER'" \
  "packages/shared" "src/approvals.test.ts" \
  "a manager decides only their own branch's row (deciderBranchId comparison dropped)"

mutate 4 "api/src/modules/transfers/transfers.service.ts" \
  "  if (row.status === 'DRAFT' || row.status === 'APPROVED') return" \
  "  if (row.status === 'DRAFT' || row.status === 'APPROVED' || row.status === 'REQUESTED') return" \
  "api" "src/modules/transfers" \
  "dispatch refuses a REQUESTED transfer (guard accepts it)"

mutate 5 "api/src/modules/writeoffs/writeoffs.service.ts" \
  "  if (decision === 'REJECTED') {" \
  "  if (decision === 'REJECTED' && false) {" \
  "api" "src/modules/writeoffs" \
  "a rejected write-off posts nothing (rejection branch skipped)"

mutate 6 "api/src/modules/products/products.service.ts" \
  "  if (currentMinor !== payload.currentPriceMinor) {" \
  "  if (currentMinor !== payload.currentPriceMinor && false) {" \
  "api" "src/modules/products/pricing-band.test.ts" \
  "an approved price change refuses a stale request (guard removed)"

mutate 7 "api/src/modules/inventory/inventory.service.ts" \
  "    roleOf(user) !== 'ADMIN' &&
    input.quantityDelta < 0 &&
    SHRINKAGE_REASONS.has(input.reasonCode)" \
  "    input.quantityDelta < 0 &&
    SHRINKAGE_REASONS.has(input.reasonCode)" \
  "api" "src/modules/inventory" \
  "a manager cannot post shrinkage directly (guard removed)"

mutate 8 "api/src/modules/pos/pos.service.ts" \
  "  if (Math.abs(variance) > tolerance) {" \
  "  if (Math.abs(variance) >= tolerance) {" \
  "api" "src/modules/pos/shift-review.test.ts" \
  "a variance exactly at tolerance raises no review (> becomes >=)"

echo "" >> "$OUT"
if [ "$MISSED" -eq 0 ]; then
  echo "MUTATIONS CAUGHT: $CAUGHT/8 — every proof failed the suite it was aimed at" >> "$OUT"
  echo "MUTATIONS CAUGHT: $CAUGHT/8"
else
  echo "MUTATIONS CAUGHT: $CAUGHT/8 — $MISSED MISSED (a missed proof is a test gap)" >> "$OUT"
  echo "MUTATIONS CAUGHT: $CAUGHT/8 — $MISSED MISSED"
fi
[ "$MISSED" -eq 0 ]
