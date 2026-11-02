# 19-01 — Shared contract, permissions, schema and migration

**Goal:** the vocabulary, the arithmetic and the storage for an opening document exist once,
and the movement ledger can name an opening without changing any existing value.

**Must be true when done**

- `OPENING` is a value of `stock_movement_type` and `stock_movement_reference`.
- `stock_opening` and `stock_opening_line` exist with the fields the API and console need.
- `inventory.opening.draft` is held by managers and admins; `inventory.opening.post` is
  admin-only.
- One shared function computes line value, counted totals, posted totals and the additive
  delta, and is tested.
- One shared CSV parser handles BOM, CRLF, quoted commas, quoted newlines and a row cap, and
  is tested.
- One shared decimal parser converts a GHS string to integer pesewas without floating point,
  and refuses negatives, malformed values and more than two decimals.
- `postMovements` treats a positive `OPENING` movement carrying a cost as valued inbound;
  the branch average adopts the cost at zero/negative on hand and blends above zero.
- A migration applies cleanly to an empty database and to the existing dev database.

## Tasks

1. `packages/shared/src/permissions.ts`: add the two permissions, manager list and admin list.
2. `packages/shared/src/openings.ts`: constants (`OPENING_MAX_ROWS`), `openingLineValueMinor`,
   `openingTotals`, `openingDelta`, `isOpeningAdditive`, tests.
3. `packages/shared/src/csv.ts`: `parseCsv` plus `parseDecimalToMinor`, tests.
4. `packages/shared/src/index.ts`: export them.
5. `api/src/modules/inventory/inventory.schema.ts`: add `OPENING` to both enums.
6. `api/src/modules/openings/openings.schema.ts`: `stock_opening_status` enum, header and
   line tables, indexes, unique idempotency per branch, number unique.
7. `api/migrations`: generate and inspect; the enum values and the new tables may share one
   migration because no row uses a new value in that transaction.
8. `api/src/modules/inventory/inventory.service.ts`: include `OPENING` in the valued-inbound
   branch.
9. `api/src/modules/platform/sequences.service.ts`: `stock_opening` kind with
   `inventory.openingPrefix`; `api/src/modules/platform/settings.validation.ts` default
   `OPEN`; `admin/src/modules/settings/utils/meta.ts` label.
10. Tests: shared arithmetic/CSV, `postMovements` opening valuation, migration applies.

## Notes

- No `stock_level` schema change: the projection is already the ledger sum.
- The status is a pg enum (`DRAFT`, `POSTED`) rather than text, so the database refuses a
  third state nobody defined.
- `stock_opening_line.product_id` is nullable because a new product does not exist until the
  admin posts. The line keeps the catalogue snapshot that will create it.
- The line stores `on_hand_at_draft` and `delta_at_draft` for the review screen; the post
  recomputes both and refuses a negative delta.

## Verification

`bunx vitest run src/modules/inventory src/modules/openings` after the schema lands, plus
the shared suite; `bun run db:generate` produces a migration with no unintended drops.
