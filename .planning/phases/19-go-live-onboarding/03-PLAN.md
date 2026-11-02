# 19-03 — Proposal opening stock and the product-creation seam

**Goal:** the everyday “manager proposes, admin approves” flow can carry the stock the
manager can see, and the bulk opener can create products through the same door.

**Must be true when done**

- `productSubmissionSchema` accepts optional `openingQuantity` (int ≥ 1) and
  `openingUnitCostMinor` (int ≥ 0); sending one without the other is refused.
- The approval subject shows the proposed opening quantity and value to the decider.
- On `APPROVED`, the product is created and a one-line posted opening document is written in
  the same transaction; the branch average is seeded.
- On `REJECTED`, no product, no stock movement and no opening document exist.
- `createProduct` accepts an optional executor so the bulk opener can create products inside
  its post transaction without nesting transactions.
- The product's `cost_price_minor` stays 0 (P11-D13); only the branch average moves.

## Tasks

1. `products.validation.ts`: add the two fields and the both-or-neither refinement.
2. `products.types.ts`: add them to the submission input/row.
3. `products.service.ts`: pass the approval's branch into `createProductFromSubmission`;
   call `openingsService.postSubmissionOpening` after the product insert; extend the subject
   loader.
4. `products.service.ts#createProduct`: accept `{ executor?: DbExecutor }`, run the existing
   work inside the caller's transaction when supplied, and keep the default transaction.
5. `openings.service.ts#postSubmissionOpening`: allocate an `OPEN-` number, insert a posted
   header/line, post the `OPENING` movement, audit. It is called inside the approval
   transaction.
6. Console: the submission form fields and the approval detail rendering (Plan 04).
7. Tests:
   - proposal with stock → approval → product exists, level and average correct, movement
     is `OPENING`, catalogue cost still 0;
   - proposal without stock → no movement;
   - rejected proposal → no product, no movement;
   - one field without the other → 400;
   - `createProduct` with an executor participates in a caller rollback.

## Notes

- A submission's product does not exist until the decision, so the opening document can only
  be written in the decision transaction. That is why this is a service function, not a
  client call.
- The approval payload is stored verbatim; old approvals without the fields keep working.

## Verification

`bunx vitest run src/modules/products src/modules/approvals` green, plus the new cases.
