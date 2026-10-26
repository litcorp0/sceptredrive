---
phase: 12-branch-ops-approvals
plan: 06
title: Price band and price-change requests
lane: api
depends_on: [03]
requirements: [BRN-03, APR-01, APR-02, APR-04, MGR-05]
---

# Plan 06 — A manager may move a price 10%, and not 11%

## Goal

A branch manager can respond to a competitor or a clearance without waiting for head office, and a
price that moves further than the band becomes a request that shows the old and the new price and
applies exactly once. The band is measured against the price the branch actually charges.

## Read first

- `00-DECISIONS.md` P12-D18 … P12-D20.
- `packages/shared/src/pricing.ts` (Plan 01) — `withinPriceBand`, `priceBandBounds`,
  `resolveEffectivePrice`.
- `api/src/modules/products/products.service.ts:416-496` — `setPriceOverride`,
  `removePriceOverride`, and the audit actions.
- `api/src/modules/products/products.repository.ts` — `findProductPriceRow`,
  `insertProductPriceRow`, `updateProductPriceRow`, `deleteProductPriceRow`.
- `api/src/modules/products/products.validation.ts:92-97` — `priceOverrideSchema`.
- `api/src/modules/approvals/approvals.service.ts` (Plan 03).

## Tasks

### 1. One read of the current effective price

`products.repository.ts` gains:

```ts
/** Base price and the branch override in one row; null when the product is unknown. */
findPriceContext(productId: string, branchId: string, executor = db): Promise<{
  basePriceMinor: number
  overrideMinor: number | null
  overrideRowId: string | null
  isActive: boolean
} | null>
```

The service resolves `currentMinor = resolveEffectivePrice(base, override)`.

### 2. The two writes become one decision

`products.types.ts`:

```ts
export type PriceWriteResult =
  | { status: 'APPLIED'; priceMinor: number }
  | { status: 'PENDING_APPROVAL'; approvalId: string }
```

`setPriceOverride` and `removePriceOverride` share one helper:

```ts
async function writeOrRequestPriceChange(
  user, actor, productId, branchId, proposedMinor: number, kind: 'SET' | 'REMOVE',
): Promise<PriceWriteResult>
```

Inside one transaction:

1. Load the price context; unknown or inactive product → 404.
2. `assertBranchAccess(user, branchId)` and an active-branch check (unchanged).
3. `currentMinor = resolveEffectivePrice(...)`.
4. If `roleOf(user) === 'ADMIN'` → apply (P12-D18: the band is a manager rule).
5. Else read `pricing.managerBandPercent` (global) and
   `withinPriceBand(currentMinor, proposedMinor, percent)`.
   - inside → apply, audit `product.price.override_set` / `_removed` with
     `after: { …, via: 'BAND' }`, return `{ status: 'APPLIED' }`;
   - outside → `requestApproval(actor, { type: 'PRICE_CHANGE', entityId: productId, branchId,
     amountMinor: proposedMinor, deciderRole: 'ADMIN', deciderBranchId: null, payload: { productId,
     branchId, currentPriceMinor: currentMinor, proposedPriceMinor: proposedMinor, bandPercent,
     kind } })`, audit `product.price.change_requested`, return `{ status: 'PENDING_APPROVAL' }`.
6. **Nothing is written to `product_price` on the request path.** The row changes only on approval.

A second request for the same product while one is pending hits the partial unique index
`(type, entity_id) WHERE status='PENDING'` and returns **409** with "A price change for this product
is already waiting for a decision". That is the desired behaviour: two pending prices for one
product is a decision nobody can make correctly.

`removePriceOverride` passes `proposedMinor = basePriceMinor` and `kind: 'REMOVE'`; a manager
deleting an override is changing the branch price to the base price and is band-checked the same
way (P12-D19).

### 3. The decision handler

```ts
registerDecisionHandler('PRICE_CHANGE', async (tx, approval, actor, decision, input) => {
  const payload = priceChangePayloadSchema.parse(approval.payload)   // 500 on a malformed payload
  if (decision === 'REJECTED') return                                // nothing to undo
  const context = await findPriceContext(payload.productId, payload.branchId, tx)
  if (!context) throw new NotFoundError('Product not found')
  const current = resolveEffectivePrice(context.basePriceMinor, context.overrideMinor)
  if (current !== payload.currentPriceMinor) {
    throw new ConflictError(
      'The price changed while this request was waiting. Reject it and raise a new one.',
    )
  }
  if (payload.kind === 'REMOVE') await deleteProductPriceRow(context.overrideRowId!, tx)
  else await updateProductPriceRow(context.overrideRowId!, { priceMinor: payload.proposedPriceMinor,
    updatedBy: actor.actorId }, tx) // or insertProductPriceRow when there is no row yet
  await writeAudit({ ...actor, action: 'product.price.override_set' | '_removed', entity: 'product',
    entityId: payload.productId, branchId: payload.branchId,
    before: { priceMinor: payload.currentPriceMinor },
    after: { priceMinor: payload.proposedPriceMinor, via: 'approval', approvalId: approval.id } }, tx)
})
```

The 409 rolls the decision back and leaves the approval `PENDING`; the admin rejects it with
`PRICE_TOO_HIGH`/`OUT_OF_POLICY` and the manager raises a new one against the new current price
(P12-D20). "Applies exactly once" is therefore a property of the status transition plus this
check, not of a comment.

### 4. Subject loader

```ts
registerSubjectLoader('PRICE_CHANGE', async (approval) => ({
  kind: 'price_change',
  productId, branchId, currentPriceMinor, proposedPriceMinor,
}))
```

The detail also returns the product name, SKU, the band percentage and the bounds
(`priceBandBounds(current, percent)`) so the screen can show "inside/outside" without recomputing.

### 5. Validation, routes, types

- `priceOverrideSchema` is unchanged; the band is not a shape rule.
- Routes and permissions are unchanged:
  `PUT /api/products/:id/prices`, `DELETE /api/products/:id/prices/:branchId` (`price.override`).
- `GET /api/products/:id/prices` gains `managerBandPercent` and, per override row, the
  `bounds: { minMinor, maxMinor }` from `priceBandBounds(effectivePrice, percent)`. The console needs
  the band to warn before the request is sent (Plan 12), and the client must not re-derive a server
  rule.
- The controller returns the `PriceWriteResult` union as `200`; the console branches on `status`.
  No `202` — the request is a completed action, not an accepted one.

### 6. Tests (`products.test.ts`, `pricing-band.test.ts`)

- band setting default 10; current 10 000 → proposed 11 000 → **APPLIED** (exactly 10%);
- current 10 000 → proposed 11 001 → **PENDING_APPROVAL**, one approval with
  `amountMinor = 11_001` and `payload.currentPriceMinor = 10_000`;
- current 10 000 → proposed 8 999 → pending (the band is symmetric);
- current 0 → proposed 1 → pending;
- admin, same out-of-band change → **APPLIED**, zero approvals;
- approve → `product_price.price_minor` = proposed, audit `via: 'approval'`; approve again → 409;
- approve after the base price changed underneath → **409**, price row unchanged, approval still
  `PENDING`;
- reject → price row unchanged;
- manager removes an override that is 20% above base → pending; removes one 5% above → applied and
  the row is gone;
- a second pending request for the same product → 409;
- `priceBandBounds(10_000, 10)` = `{ minMinor: 9_000, maxMinor: 11_000 }`;
- a manager's own branch only: setting a price for another branch → 403 (existing rule, re-proven).

## Verification

```bash
bun run --filter api test
bun run check-types
bun run lint
```

Expected: API grows by ~18; the existing `setPriceOverride` tests are updated to read
`status: 'APPLIED'` and the edit is named in the commit body.

## Commits

1. `feat(api): manager price band measured against the branch price`
2. `feat(api): out-of-band price changes become requests`
3. `feat(api): approved price change applies once or refuses a stale request`
4. `test(api): band boundaries, stale request and override removal`

## Done when

- Exactly 10% is inside the band and 10.01% is not.
- A manager cannot move a price outside the band by deleting the override.
- An approved change lands on the price the admin saw, or does not land at all.
