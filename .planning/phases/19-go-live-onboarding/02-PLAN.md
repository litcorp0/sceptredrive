# 19-02 — Opening-stock API

**Goal:** a manager can preview and save a go-live document, and an admin can post it once,
with every stock effect and every new product committing together.

**Must be true when done**

- `POST /api/openings/preview` validates rows and returns, per line: status
  `NEW`/`EXISTING`, product id/sku when matched, on-hand, counted, delta, counted value,
  delta value, warnings and row errors; totals and `canPost`.
- `POST /api/openings` creates a `DRAFT` from valid rows; the branch and actor come from the
  session, never the body. A duplicate idempotency key returns the existing document.
- `GET /api/openings`, `GET /api/openings/:id` are branch-scoped; managers see their branch.
- `DELETE /api/openings/:id` deletes a draft only; a posted document is a 409.
- `POST /api/openings/:id/post` is admin-only, locks the header, revalidates every row,
  creates missing products, posts `OPENING` movements for positive deltas, stamps totals and
  `posted_at`, audits the post, and is idempotent on retry.
- A negative delta is refused with the row named; a zero delta writes no movement; a
  zero-quantity row creates a product only if it is new.
- A posted document cannot be edited or deleted.
- The movement filter and the stock report already accept `OPENING` through the enum.

## Tasks

1. `openings.types.ts`: inputs, preview row, detail, list row, totals.
2. `openings.validation.ts`: strict Zod for preview/create/post/query/param; row cap; money
   and quantity ranges.
3. `openings.repository.ts`: insert/update/lock/delete header and lines; list/detail; match
   products by SKU, barcode and normalised name+category; read levels for a set of products.
4. `openings.service.ts`:
   - `previewOpening` (resolve catalogue names, match, classify, compute values, errors);
   - `createOpening` (idempotent, store rows and snapshots);
   - `listOpenings` / `getOpening`;
   - `deleteOpening`;
   - `postOpening` (admin, transactional; creates products via the products service seam,
     posts movements, updates totals, audits);
   - `postSubmissionOpening` for Plan 03.
5. `openings.controller.ts`, `openings.routes.ts`; wire in `api/src/app.ts`.
6. Tests in `openings.test.ts` and `openings.api.test.ts`:
   - preview classifications and errors;
   - create → detail → post → levels, averages, movements, audit;
   - duplicate idempotency returns one document;
   - double post returns the same document without new movements;
   - manager post 403; manager draft at another branch 403; admin allowed;
   - negative delta 409; zero quantity no movement; uncosted line flagged;
   - new product created with system SKU and the file price;
   - existing product price unchanged.

## Notes

- Product creation at post calls `productsService.createProduct` with an executor (Plan 03
  adds the seam) so duplicate checks, SKU allocation, barcode uniqueness and audit are the
  same code as the direct create path.
- The preview is pure: no rows are written. The draft is written only when the operator
  saves it.
- `countedAt` is the physical count date; `postedAt` is when the ledger moved. The report
  shows both.
- Totals stored: `lineCount`, `newProductCount`, `totalUnits`, `countedValueMinor`,
  `postedValueMinor`, `uncostedLineCount`.

## Verification

`bunx vitest run src/modules/openings` green, with the named cases.
