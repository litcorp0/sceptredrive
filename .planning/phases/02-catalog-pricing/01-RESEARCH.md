# Research — Phase 2: Catalog & Pricing

**Researched:** 2026-10-18
**Sources:** GRA VAT pages and notices (gra.gov.gh, Act 1151 reforms), GNA and EY
summaries of the 2026 VAT reform, USDA FAS Ghana tax report (Feb 2026), Drizzle ORM
docs (indexes), local `postgres:18-alpine` verification, Phase 1 codebase patterns.

## 1. Ghana tax (verified current law)

- **VAT Act 2025 (Act 1151)** took effect **2026-01-01**, replacing Act 870.
- Structure: **VAT 15% + NHIL 2.5% + GETFund 2.5% = 20%, all on the same base**
  (the "re-coupled" model). The old cascading build-up (levies inside the VAT base) is
  abolished, as are the COVID-19 Health Recovery Levy (1%) and the flat-rate schemes
  (3% retail goods, 5% immovable property).
- NHIL and GETFund are now input-deductible (matters for purchasing, Phase 5).
- Zero-rated and exempt supplies carry 0% VAT, 0% NHIL, 0% GETFund.
- Registration threshold for goods: GHS 750,000 (context only; GikAutos is registered).
- **GRA worked example:** selling price 1,000 → NHIL 25, GETFund 25, VAT 150, total 1,200.

**Implication:** the project's locked 20% decision is current law; the tax engine models
`STANDARD` (20%), `ZERO_RATED`, and `EXEMPT` and supports both inclusive and exclusive
pricing.

### Tax math for integer minor units (pesewas)

Rates as integer basis points (bp): VAT 1500, NHIL 250, GETFund 250 (sum 2000).

- **Exclusive:** `base = amount`; `vat = round(base × 1500 / 10000)`;
  `nhil = round(base × 250 / 10000)`; `getfund = round(base × 250 / 10000)`;
  `total = base + vat + nhil + getfund`.
- **Inclusive:** `base = round(total × 10000 / 12000)`; components computed on `base`;
  `residual = total − (base + vat + nhil + getfund)` is added to `vat` so the breakdown
  sums to the total exactly. Residual is at most a few pesewas.
- `ZERO_RATED` / `EXEMPT`: `base = amount`, components 0, `total = amount`.
- All arithmetic is integer (`Math.round` on integer products/quotients); the engine
  throws on non-integer, negative, or unsafe-integer inputs.
- Line-level computation is the standard for POS (Phase 6); invoice totals are sums of
  line breakdowns (`addTaxBreakdowns`).

## 2. Postgres / Drizzle specifics

- `pg_trgm` is available in `postgres:18-alpine`: verified with
  `CREATE EXTENSION IF NOT EXISTS pg_trgm` against the dev database.
- Drizzle 0.45.4 supports expression indexes: `index('x').using('gin', sql\`${col}
  gin_trgm_ops\`)` and partial unique indexes (pattern already used by `setting`).
- drizzle-kit does not emit `CREATE EXTENSION`; the generated migration for Phase 2 is
  edited to prepend `CREATE EXTENSION IF NOT EXISTS pg_trgm;` before the trigram index.
- Case-insensitive uniqueness (category/brand names): unique index on `lower(name)` via
  `sql` expression; SKU and barcode uniqueness is exact-match `uniqueIndex`.
- Search plan: name substring via GIN trigram (`ILIKE '%q%'` benefits); SKU prefix via
  btree (`ILIKE 'q%'` uses the index with `text_pattern_ops`? — plain btree on sku serves
  exact equality; prefix search at 5k SKUs is acceptable without a special opclass);
  barcode equality via its unique index.
- All catalog tables: uuid PKs, `created_by`/`updated_by` text (actor ids),
  `timestamptz` created/updated with `$onUpdate`.

## 3. Codebase patterns to reuse (Phase 1)

- **Seven-file module layout** (routes/validation/controller/service/repository/schema/
  types) — see AGENTS.md.
- **Sequence allocation:** `allocateStaffId` locks the `setting` row for
  `staff.idSequence` (`FOR UPDATE`), bumps it, and formats `GA-0001`. Phase 2 generalizes
  this into `allocateFromSequence(key)` in the platform settings service and reimplements
  `allocateStaffId` on top; SKUs use `catalog.skuSequence` + `catalog.skuPrefix`.
- **Settings definitions:** typed `SETTING_DEFINITIONS` in
  `api/src/modules/platform/settings.validation.ts` — Phase 2 adds `catalog.skuPrefix`,
  `catalog.skuSequence`, `pricing.taxMode`.
- **Audit in the same transaction** via `writeAudit(actor, tx)`; controllers build the
  actor with `actorFromContext(c)`.
- **Permissions registry** in `packages/shared/src/permissions.ts` with
  `ROLE_PERMISSIONS` and `can()`; tests live beside it.
- **Seed helpers** in `api/src/seed/helpers.ts` (`ensureBranch`, `ensureSetting`, …) —
  Phase 2 adds catalog ensure-helpers; the demo seed currently notes "catalog demo data
  arrives in Phase 2".
- **Admin console patterns:** API client + hand-maintained types
  (`admin/src/lib/api.ts`, `api-types.ts`), permission helper (`admin/src/lib/role.ts`),
  `useDebouncedValue`, shared table components (`PageHeader`, `TableMessage`,
  `Pagination`, `StatusBadge`, `ConfirmDialog`), TanStack Query keys + invalidation,
  toasts via `toastApiError`.

## 4. Design notes

- **Effective price:** `override ?? base` — trivial resolver in shared so the POS reuses
  the exact rule in Phase 6.
- **Search response** should include `effectivePriceMinor` (and `basePriceMinor`) when a
  branch is in scope, plus barcode presence, so list screens need one round trip.
- **Category archive guard:** block when active children or active products reference the
  category (409); re-parenting a category that has children is blocked (two levels).
- **Brand/unit archive guard:** block when active products reference them (409).
- **Barcode normalization:** trim only (codes are case-sensitive by convention; scanners
  emit digits). Length 6–64, `[A-Za-z0-9-]`.
- **SKU suggestion is a peek:** `GET /api/products/suggest-sku` returns the next value
  without consuming it; creation allocates atomically (a race simply 409s and retries).
- **Tax preview** in the console calls the shared engine with the `pricing.taxMode`
  setting — display only; stored amounts are what the API validated.
