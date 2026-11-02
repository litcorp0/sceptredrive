# 19 — Summary

**Implemented:** 2026-11-02. The seven operator decisions in `00-CONTEXT.md` are in code.

## What shipped

| Plan | What it does now | Proof |
|---|---|---|
| 01 | `OPENING` movement/reference; `stock_opening` + `stock_opening_line`; `inventory.opening.draft` (manager + admin) and `inventory.opening.post` (admin); shared opening arithmetic and a strict CSV reader/money parser | shared suite; migration 0020 applies |
| 02 | `POST /api/openings/preview`, draft create/list/get/delete, transactional post, audit and idempotency; a new product is created at post through the catalogue service | `openings.api.test.ts` (7 cases) |
| 03 | A manager's product proposal may carry opening quantity/unit cost; approval creates the product and a one-line posted opening in the same decision; `createProduct` accepts a caller executor | opening API suite's proposal case; products suite unchanged |
| 04 | Inventory → Opening stock list/new/detail; CSV upload or paste, preview, draft save, admin post; proposal fields; approval display; prefilled “Open stock now”; adjust-dialog copy fixed | admin typecheck + build |
| 05 | `OPENING` appears in the movement filter and stock report automatically (enum-derived); opening totals in the list/detail; `RUNBOOK.md` | movement filter test; runbook committed |
| 06 | Full gates and this evidence | see below |

## The shape

- **Counted quantity, not a delta.** The line stores what the shelf held; post computes
  `delta = counted − on-hand` at that moment.
- **Additive only.** A shelf lower than the system is a stock count/write-off, refused by the
  opening with the row named.
- **One combined document.** A row carries the catalogue fields and the count; a row that
  matches an existing product stocks it, a row that matches nothing becomes a product created
  by the admin at post. Existing products are never renamed and their prices are not changed.
- **Cost is required for quantity > 0.** A zero cost is allowed only with the admin's explicit
  acknowledgement at post, and is counted as uncosted.
- **Draft → post.** A manager drafts; only an admin posts. Posted documents are immutable;
  drafts can be deleted.
- **Idempotent.** A create key is unique per branch; retrying a post returns the posted
  document and writes no movement.
- **Everyday path.** A manager's `PRODUCT_CREATE` proposal can carry `openingQuantity` +
  `openingUnitCostMinor`; approving it creates the product and its opening in one transaction.

## Numbers

- shared **355 → 368** (+13): opening arithmetic, CSV parsing, permission.
- API **869 → 876 / 64 files** (+7): the opening API and proposal cases.
- desktop **620** (unchanged by this phase; the current gate).
- `check-types` **7/7**, `lint` exit 0, `build` green, `modules:check:strict` 21/21 admin and
  16/16 POS, brand gate **1 282** files.
- No `stock_level` schema change, no new synced table, `powersync/sync-config.yaml` empty diff.

## Deviations, recorded rather than hidden

- **No separate product import.** Because the operator chose system-generated SKUs and
  250–1,000 lines, splitting the catalogue from the stock would have left the stock file with
  no reliable matching key. Products are created at post instead.
- **No separate report screen.** The list/detail totals plus the stock report's `OPENING`
  movement row carry the value; a dedicated opening report is a later read model if needed.
- **`postedValueMinor` is the movement value.** When the branch was oversold, the ledger adds
  enough units to cover the negative and reach the count, so the posted value can exceed the
  counted value. Both are shown; the difference is the oversold units the old sales left
  uncosted.
- **The approval's “Open stock now” is the single-product adjust dialog**, not the bulk
  wizard. It is the 18-05 carry-forward, now prefilled; the bulk path is the opening document.
- **The browser parses the CSV into JSON rows.** The server re-validates every field and owns
  the value arithmetic; a 5,000-row file is therefore bounded by the 2 MB upload guard.

## Deliberately not done / carried

- Historical sales, customer/credit/loyalty balances, supplier debts and old receipts are not
  migrated; see `RUNBOOK.md`.
- Retroactive cost variance for sales made before the first cost (Phase 17 D7) remains a
  separate append-only document.
- A downloadable CSV template and an import-error export: the page shows the header line and
  the per-row errors instead.
- A product `description` column in the go-live file; the catalogue keeps descriptions for
  the product screen, and the opening document carries the fields it needs to create a
  product.
- The full browser walkthrough with screenshots; the phase proves the API over HTTP and the
  console by typecheck/build. `test:counter` was not run.
- The list's filters are in component state, not the URL (the branch switcher is the branch
  filter). A URL state is a small later polish.

## Verification

The test database is shared and accumulates; the full API suite is run on a freshly created
`sceptre_drive_test` (the documented recovery for the analytics aggregates). See
`evidence/suites.txt` for the gate outputs and `19-VERIFICATION.md` for the criterion map.
