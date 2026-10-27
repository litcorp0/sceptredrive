#!/usr/bin/env bash
#
# Phase 13 — mutation proofs.
#
# Each mutation is applied to the product code, the narrow suite that must catch it is run,
# the failure is recorded, and the file is restored. A mutation that fails nothing is a gap
# in the tests, not a pass. Writes `mutations.txt` beside this script.
#
#   bash .planning/phases/13-pos-payments-returns/evidence/mutations.sh
#
# Leaves the tree clean: every file is restored with `git checkout --`, and the script ends by
# asserting that nothing under api/, desktop/ or packages/ is modified.
set -uo pipefail

cd "$(dirname "$0")/../../../.." || exit 1
OUT=".planning/phases/13-pos-payments-returns/evidence/mutations.txt"
: > "$OUT"

CAUGHT=0
MISSED=0

# Whatever was already modified before the run (this pass edits `desktop/test/e2e/*` and
# nothing under the mutation paths) is not a leftover mutation.
BEFORE="$(git status --porcelain -- api desktop packages)"


# Applies one anchored replacement; fails loudly when the anchor is not unique.
apply_edit() {
  local file="$1" from="$2" to="$3"
  python3 - "$file" "$from" "$to" <<'PY'
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
}

run_suite() {
  local dir="$1" test="$2"
  echo "\$ (cd $dir && bunx vitest run $test)" >> "$OUT"
  ( cd "$dir" && bunx vitest run "$test" ) >> "$OUT" 2>&1
  local status=$?
  echo "[exit $status]" >> "$OUT"
  return $status
}

mutate() {
  local n="$1" file="$2" from="$3" to="$4" dir="$5" test="$6" label="$7"
  echo "" >> "$OUT"
  echo "### Mutation $n — $label" >> "$OUT"
  echo "file: $file" >> "$OUT"
  echo "  - $from" >> "$OUT"
  echo "  + $to" >> "$OUT"

  if ! apply_edit "$file" "$from" "$to" >> "$OUT" 2>&1; then
    echo "RESULT: NOT APPLIED (treated as a missed proof)" >> "$OUT"
    git checkout -- "$file"
    MISSED=$((MISSED+1))
    return
  fi

  run_suite "$dir" "$test"
  local status=$?
  git checkout -- "$file"

  if [ "$status" -ne 0 ]; then
    echo "RESULT: CAUGHT by $test" >> "$OUT"
    CAUGHT=$((CAUGHT+1))
  else
    echo "RESULT: **MISSED** — the suite passed against a broken rule" >> "$OUT"
    MISSED=$((MISSED+1))
  fi
}

# Mutation 8 needs two edits in one file: the table import and the stamp itself. Reverted
# together, counted once.
mutate_refund_stamp() {
  local n="8"
  local file="api/src/modules/pos/pos.service.ts"
  echo "" >> "$OUT"
  echo "### Mutation $n — the REFUND decision handler stamps refunded_minor" >> "$OUT"
  echo "file: $file" >> "$OUT"
  echo "  - import { cartVoid, saleTender } from './pos.schema.ts'" >> "$OUT"
  echo "  + import { cartVoid, refund, saleTender } from './pos.schema.ts'" >> "$OUT"
  echo "  -   const row = await findRefundById(approval.entityId, tx)" >> "$OUT"
  echo "  +   const row = await findRefundById(approval.entityId, tx)" >> "$OUT"
  echo "  +   await tx.update(refund).set({ refundedMinor: row.refundedMinor + 1 }).where(eq(refund.id, row.id))" >> "$OUT"

  apply_edit "$file" \
    "import { cartVoid, saleTender } from './pos.schema.ts'" \
    "import { cartVoid, refund, saleTender } from './pos.schema.ts'" >> "$OUT" 2>&1 || {
    echo "RESULT: NOT APPLIED (treated as a missed proof)" >> "$OUT"
    git checkout -- "$file"
    MISSED=$((MISSED+1))
    return
  }
  apply_edit "$file" \
    "  const row = await findRefundById(approval.entityId, tx)" \
    "  const row = await findRefundById(approval.entityId, tx)
  await tx.update(refund).set({ refundedMinor: row.refundedMinor + 1 }).where(eq(refund.id, row.id))" >> "$OUT" 2>&1 || {
    echo "RESULT: NOT APPLIED (treated as a missed proof)" >> "$OUT"
    git checkout -- "$file"
    MISSED=$((MISSED+1))
    return
  }

  run_suite "api" "src/modules/pos/pos.refund.test.ts"
  local status=$?
  git checkout -- "$file"

  if [ "$status" -ne 0 ]; then
    echo "RESULT: CAUGHT by src/modules/pos/pos.refund.test.ts" >> "$OUT"
    CAUGHT=$((CAUGHT+1))
  else
    echo "RESULT: **MISSED** — the suite passed against a broken rule" >> "$OUT"
    MISSED=$((MISSED+1))
  fi
}

mutate 1 "packages/shared/src/refund.ts" \
  "  return refundedMinor >= thresholdMinor" \
  "  return refundedMinor > thresholdMinor" \
  "packages/shared" "src/refund.test.ts" \
  "the approval threshold is inclusive (>= becomes >)"

mutate 2 "api/src/modules/pos/pos.service.ts" \
  "      if (paymentRow.status !== 'PAID') {" \
  "      if (paymentRow.status !== 'PAID' && false) {" \
  "api" "src/modules/pos/pos.tender.test.ts" \
  "a sale refuses a tender whose payment has not settled (PAID check dropped)"

mutate 3 "packages/shared/src/tender.ts" \
  "  if (changeMinor > totals.cashMinor) {" \
  "  if (changeMinor > totals.cashMinor && false) {" \
  "packages/shared" "src/tender.test.ts" \
  "change may not exceed the cash tender (OVERPAID_BY_ELECTRONIC dropped)"

mutate 4 "api/src/modules/pos/pos.service.ts" \
  "  if (problem) throw refundProblemError(problem)" \
  "  if (problem && problem !== 'EXCEEDS_TENDER') throw refundProblemError(problem)" \
  "api" "src/modules/pos/pos.refund.test.ts" \
  "a refund stops checking each tender's remainder (REFUND_EXCEEDS_TENDER)"

mutate 5 "packages/shared/src/refund.ts" \
  "  return restock === 'RESALABLE'" \
  "  return restock === 'RESALABLE' || restock === 'DAMAGED'" \
  "api" "src/modules/pos/pos.refund.test.ts" \
  "a DAMAGED line posts no stock movement (movesStockBack widened)"

mutate 6 "api/src/modules/payments/payments.service.ts" \
  "  if (!secret || !signature) return false" \
  "  if (!secret || !signature) return true" \
  "api" "src/modules/payments/payments.webhook.test.ts" \
  "the webhook refuses a body with no signature (guard accepts it)"

mutate 7 "api/src/modules/payments/payments.service.ts" \
  "        orphaned: wasWaiting || row.orphaned," \
  "        orphaned: row.orphaned," \
  "api" "src/modules/payments/payments.test.ts" \
  "a settlement after abandonment is marked orphaned (flag dropped)"

mutate_refund_stamp

# --- the tree must be exactly as it was -----------------------------------------------------
echo "" >> "$OUT"
echo "### tree after the run" >> "$OUT"
if [ -n "$BEFORE" ]; then
  DIRTY="$(git status --porcelain -- api desktop packages | grep -Fxv "$BEFORE" || true)"
else
  DIRTY="$(git status --porcelain -- api desktop packages)"
fi
if [ -n "$DIRTY" ]; then
  echo "DIRTY:" >> "$OUT"
  echo "$DIRTY" >> "$OUT"
  echo "RESULT: **the tree is not clean — a mutation was not reverted**" >> "$OUT"
  MISSED=$((MISSED+1))
else
  echo "clean: no modified file under api/, desktop/ or packages/" >> "$OUT"
fi

echo "" >> "$OUT"
if [ "$MISSED" -eq 0 ]; then
  echo "MUTATIONS CAUGHT: $CAUGHT/8 — every proof failed the suite it was aimed at" >> "$OUT"
  echo "MUTATIONS CAUGHT: $CAUGHT/8"
else
  echo "MUTATIONS CAUGHT: $CAUGHT/8 — $MISSED MISSED (a missed proof is a test gap)" >> "$OUT"
  echo "MUTATIONS CAUGHT: $CAUGHT/8 — $MISSED MISSED"
fi
[ "$MISSED" -eq 0 ]
