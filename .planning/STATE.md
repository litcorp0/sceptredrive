# STATE — GikAutos v1

**Milestone:** v1
**Updated:** 2026-10-18
**Status:** Phase 4 execution in progress — Plans 01–02 complete and green (api 192/192,
shared 54/54); live smoke test passed (create → suffix search → detail).
**Next action:** Execute Plan 03 (credit module — profiles, ledger, enforcement,
repayments, aging, statements) following the GSD waves in `00-CONTEXT.md`.

---

## Progress

| Phase | Name | Status |
|---|---|---|
| 0 | Planning & decisions | ✅ Complete |
| 1 | Foundation & Platform | ✅ Complete (4/4 plans, verified) |
| 2 | Catalog & Pricing | ✅ Complete (6/6 plans, verified) |
| 3 | Inventory & Transfers | ✅ Complete (8/8 plans, verified) |
| 4 | Customers, Credit & Loyalty | 🟨 Executing (2/8 plans) |
| 5 | Suppliers & Payables | ⬜ Not started |
| 6 | POS Offline Core | ⬜ Not started |
| 7 | POS Payments, Returns & Shifts | ⬜ Not started |
| 8 | Admin Operations, Reports & E-VAT | ⬜ Not started |
| 9 | Production Hardening & Launch | ⬜ Not started |

### Phase 1 plan progress

| Plan | Title | Status |
|---|---|---|
| 01 | Workspace, tooling, Postgres, shared and db packages | ✅ Complete |
| 02 | API skeleton, configuration, logging, health, first schema | ✅ Complete |
| 03 | Auth, RBAC, organisation APIs, audit, seeds | ✅ Complete |
| 04 | Admin shell, auth flows, CRUD screens, CI, verification | ✅ Complete |

### Phase 2 plan progress

| Plan | Title | Status |
|---|---|---|
| 01 | Shared tax engine and pricing helpers | ✅ Complete |
| 02 | Catalog schema, migration, settings, demo seed | ✅ Complete |
| 03 | Catalog module APIs (categories, brands, units) | ✅ Complete |
| 04 | Products module APIs (products, barcodes, prices, search) | ✅ Complete |
| 05 | Console catalog screens and settings extensions | ✅ Complete |
| 06 | Phase 2 verification and state update | ✅ Complete |

### Phase 3 plan progress

| Plan | Title | Status |
|---|---|---|
| 01 | Inventory schema, migration, settings, and demo seed | ✅ Complete |
| 02 | Inventory core service — ledger, projection, average cost, guards | ✅ Complete |
| 03 | Inventory APIs — receipts, adjustments, stock, history, low stock, thresholds | ✅ Complete |
| 04 | Transfers module — draft, dispatch, receive, short-close | ✅ Complete |
| 05 | Counts module — snapshot, entry, post | ✅ Complete |
| 06 | Console — inventory shell, stock screens, receive, adjust, thresholds | ✅ Complete |
| 07 | Console — transfers and stock count screens | ✅ Complete |
| 08 | Phase 3 verification and state update | ✅ Complete |

### Phase 4 plan progress

| Plan | Title | Status |
|---|---|---|
| 01 | Phase 4 schema, settings, permissions, phone helper, and demo seed | ✅ Complete |
| 02 | Customers module — identity, search, lifecycle | ✅ Complete |
| 03 | Credit module — profiles, ledger, enforcement, repayments, aging, statements | ⬜ Pending |
| 04 | Loyalty module — account, ledger, lots, FEFO, expiry engine | ⬜ Pending |
| 05 | pg-boss jobs infrastructure and the loyalty expiry schedule | ⬜ Pending |
| 06 | Console — customers, credit ledger, repayments, statements, aging | ⬜ Pending |
| 07 | Console — loyalty history, liability report, and settings | ⬜ Pending |
| 08 | Phase 4 verification and state update | ⬜ Pending |

---

## Repository State

- Fresh git history on `dev`; planning + Phase 1 committed. **No git remote exists yet.**
- Root Bun workspace with catalogs; `@gikautos/shared` (roles, permissions, branch
  codes) and `@gikautos/db` (Drizzle client, config, migrations).
- API boots on Node 24 with native TypeScript type stripping: `bun run dev:api`.
  Validated env, pino logs, request IDs, security headers, CORS, `/health`, `/ready`.
- Postgres 18 via `compose.yaml` on host port **5433**. `wal_level=logical` and 10
  replication slots for Phase 6.
- API serves auth (public sign-up blocked), branches, terminals, enrollment, devices,
  staff, `/api/me/password`, audit (with `actorId` + `actorStaffId` filters), settings.
  Middleware: session loading (cookie cache bypassed for authorization), permission
  checks, fresh-session gate, branch scoping, rate limiting.
- Admin console (`admin/`, TanStack Start 1.169 + React 19 + Tailwind v4 + shadcn
  Radix/new-york): login/forgot/reset/2FA pages, forced password change, forced TOTP for
  admins, permission-aware shell with branch switcher, and CRUD screens for branches,
  terminals (enrollment + devices), staff (temp passwords, resets), audit (diff viewer),
  and settings. Dense neutral design (system font stack, zinc tokens).
- Dev email: file provider writes to `api/.mail/` in development (gitignored); console
  provider elsewhere; Resend when `RESEND_API_KEY` is set.
- Tests: `bun run db:test:prepare` then `bun run test` — shared 46/46, api 176/176 against
  `gikautos_test`.
- CI: `.github/workflows/ci.yml` (checkout@v7, setup-bun@v2, Postgres 18 service, lint →
  check-types → migrate → test → build). Validated with actionlint; full sequence run
  locally. **Remote run pending a git remote.**
- `.planning/phases/01-foundation/01-VERIFICATION.md` records all evidence, deviations,
  and the human verification checklist.

### Phase 2 additions

- `@gikautos/shared` now exports the Ghana tax engine (`taxBreakdown`, basis-point rates,
  `addTaxBreakdowns`) and pricing helpers (`resolveEffectivePrice`, `isValidPriceMinor`) —
  integer-only, reused by API, console preview, and (Phase 6) the offline POS.
- Catalog module (`api/src/modules/catalog`): categories (two-level tree, depth/self-parent/
  duplicate guards, guarded archive/reactivate), brands, units (uppercase codes, immutable).
- Products module (`api/src/modules/products`): create with atomic SKU allocation,
  suggest-sku peek, update/archive, barcode add/remove, branch price overrides,
  trigram-backed search with branch-aware effective pricing.
- Migration `0002_fresh_shen.sql` creates `pg_trgm` and the `product_name_trgm_idx` GIN
  index; `db:seed --demo` seeds a browsable catalog idempotently (12 products, 14 barcodes).
- Console: Catalog section (Products/Categories/Brands/Units tabs), product editor with
  live tax preview and per-branch override panel, catalog settings (SKU, tax mode) in
  Settings. `formatGhs`/`parseGhsToMinor`/`formatMinorPlain` in `admin/src/lib/format.ts`.
- Verification: fresh-DB cycle, API walkthrough 31/31, real browser (Playwright)
  walkthrough 29/29 with screenshots and scripts under
  `.planning/phases/02-catalog-pricing/evidence/`.

### Phase 3 additions

- `@gikautos/shared` exports `averageCostAfterReceipt` (integer weighted average,
  half-up) used by the API and the demo seed.
- Inventory module (`api/src/modules/inventory`): append-only `stock_movement` ledger +
  `stock_level` projection, receipts (`stock_receipt`, `stock_receipt_line`),
  adjustments, per-branch thresholds, stock/history/low-stock reads; one posting
  service with sorted per-product locks (`lockOrCreateLevel`) enforcing the non-negative
  guard (409).
- Transfers module (`api/src/modules/transfers`): draft → dispatch → receive →
  short-close with source/destination on-hand context, cost carry to the destination,
  side-scoped authority, direction-filtered list reads.
- Counts module (`api/src/modules/counts`): snapshot at open, entry, post (variance
  movements only), cancel; negative-guard 409 names the offending products.
- Guards: product archive blocked while any branch holds stock; warehouses cannot host
  POS terminals.
- Sequences/settings: `GRN-#####`, `TRF-#####`, `CNT-#####`; demo seed adds opening
  stock (GRN-00001 @ ACC-WH1, GRN-00002 @ ACC-SPX) and thresholds GIK-00007=5 /
  GIK-00011=10 at ACC-SPX, idempotently.
- Console: Inventory section (Stock / Transfers / Counts tabs) — stock list with
  search + low filter, product detail with movement history, receive / adjust /
  threshold dialogs, transfer detail (dispatch / receive / short-close), count
  entry/posting; permission-aware actions.
- Verification: fresh-DB cycle (demo seed ×2 idempotent), HTTP + SQL walkthrough 92/92
  (ledger invariant SQL, audit rows, permission matrix, warehouse + archive guards),
  browser walkthroughs 15/15 + 6/6; scripts and screenshots under
  `.planning/phases/03-inventory-transfers/evidence/`.

### Phase 4 additions (in progress)

- Schema (migration `0004_cute_namor.sql`): `customer` (global identity, partial unique
  phone index `WHERE anonymized_at IS NULL`), `credit_profile` + append-only
  `credit_ledger_entry`, `loyalty_account` + append-only `loyalty_ledger_entry` +
  `loyalty_lot` + `loyalty_lot_consumption`; `pg_trgm` indexes on customer name/phone.
- Settings: `loyalty.minimumRedeemPoints`, `credit.repaymentPrefix` (REP),
  `credit.repaymentSequence` (REP-#####); `loyalty.earnPointsPerCedi` is integer-only.
- Permissions: `customer.read/create/update/archive/anonymize`,
  `credit.read/profile.manage/repayment/adjust/override`, `loyalty.read/adjust/settings`
  (archive, anonymize, and loyalty settings are admin-only) plus
  `packages/shared/src/phone.ts` (`normalizeGhanaPhone` / `formatGhanaPhone`).
- Demo seed: 3 customers at ACC-SPX — Akosua (credit limit GHS 500, opening CHARGE
  GHS 120, sequenced REP repayment GHS 60 → balance GHS 60), Kwame (250 points, 12-month
  lot), Efua (plain).
- Customers module (`api/src/modules/customers`): search by phone digit-suffix or name
  ILIKE (trigram-backed), `page`/`pageSize`, archived hidden unless admin
  `includeArchived`, `branchId` admin filter; create normalizes the phone, dedupes (409
  with the existing id), and bootstraps the loyalty account in the same transaction;
  archive/reactivate/anonymize are audited; anonymize requires zero credit balances and
  zero loyalty points, scrubs PII in place, and releases the phone.

---

## Decisions Log

| Date | Decision |
|---|---|
| 2026-10-17 | The earlier prototype and its planning are discarded; fresh git history on `dev`. |
| 2026-10-17 | v1 scope: POS + back office + inventory + suppliers + credit + loyalty + Paystack. E-commerce, delivery, payroll, GL, AI, fitment, and mobile are out of scope. |
| 2026-10-17 | API: Hono + Drizzle + Better Auth on Node 24. |
| 2026-10-17 | Offline sync: PowerSync Cloud (Free → Pro), Web SDK in the Electron renderer. |
| 2026-10-17 | Database: PostgreSQL 17 on a VPS via Docker; PowerSync Cloud connects over TLS with an IP allowlist. |
| 2026-10-17 | Admin/Manager: TanStack Start. Desktop POS: Electron Forge + Vite + React + shadcn + Tailwind. |
| 2026-10-17 | Ghana GHS; VAT 15% + NHIL 2.5% + GETFund 2.5% = 20%; E-VAT receipt contract now, GRA adapter mock until credentials. |
| 2026-10-17 | Roles: Admin (global), Manager (branch), Cashier (terminal). One cashier per terminal per shift. |
| 2026-10-17 | Credit is branch-local; customer identity and loyalty are global. |
| 2026-10-17 | Offline: cash + credit work; MoMo/card/bank require internet. Never block a sale; oversell, over-limit credit, and loyalty double-spend become reconciliation conflicts. |
| 2026-10-17 | Loyalty: configurable; defaults 1 pt/GHS 1, 100 pts = GHS 1, 12-month expiry. |
| 2026-10-17 | Suppliers: invoices + payments ledger; Paystack transfers + manual fallback. |
| 2026-10-17 | Deployment: one VPS, separate staging/prod Docker stacks, Caddy, GitHub Actions, R2 backups. |
| 2026-10-17 | Scale target: 5 branches, 20 terminals, 5k SKUs, 20k customers. Manual data entry only. |
| 2026-10-17 | Plan 03: session freshness is measured from `session.createdAt` (Better Auth semantics), not updatedAt. |
| 2026-10-17 | Plan 03: public sign-up is blocked at the route level with `autoSignIn: false`; `disableSignUp` would also block server-side staff creation. |
| 2026-10-17 | Plan 03: added `branch.deactivate` as an admin-only permission. |
| 2026-10-17 | Plan 03: enrollment codes are HMAC-hashed with the auth secret, one live code per terminal, redeem rate limited (Phase 6 contract returns 501). |
| 2026-10-17 | Plan 03: `pinHash`/`pinVersion` are stored with `returned: false` and never leave the server. |
| 2026-10-17 | Plan 03: tests use `gikautos_test` (`bun run db:test:prepare`); `TEST_DATABASE_URL` overrides for CI. |
| 2026-10-17 | API modules follow a fixed seven-file layout (`routes`, `validation`, `controller`, `service`, `repository`, `schema`, `types`); `schema` = Drizzle tables, `validation` = Zod schemas + validators. See AGENTS.md. |
| 2026-10-17 | Drizzle tables live in `api/src/modules/*/*.schema.ts`; drizzle-kit config, migrations, and seeds live in `api/`; `packages/db` is only the Postgres client. |
| 2026-10-18 | Console design: dense neutral ops console (system font stack, zinc tokens, compact tables); decorative scaffold styling pruned. Radix/new-york shadcn kept (no Base UI migration mid-project). |
| 2026-10-18 | Development email writes to `api/.mail/` (file provider); message bodies and tokens never reach logs. |
| 2026-10-18 | `GET /api/audit` supports `actorId` (user id) and `actorStaffId` (e.g. GA-0001) filters. |
| 2026-10-18 | Authorization never reads the session cookie cache: `loadSession` always fetches fresh (`disableCookieCache: true`), so role/branch/2FA/mustChangePassword changes apply immediately. |
| 2026-10-18 | Admin build script pins `NODE_ENV=production` (SSR bundle mixes dev JSX runtime otherwise). |
| 2026-10-18 | Vite: `envDir` = repo root; `resolve.dedupe` + `ssr.noExternal: ["sonner"]` prevent a second React copy from the Bun store. |
| 2026-10-18 | Forced flows order: password change first (API lock), then TOTP setup for admins; `/change-password` renders standalone. |
| 2026-10-18 | Phase 2: category `PATCH` updates name/parent only; archiving goes through the guarded archive/reactivate endpoints (no `isActive` on PATCH) so guards cannot be bypassed. |
| 2026-10-18 | Phase 2: saving a suggested SKU advances `catalog.skuSequence` (`advanceSequencePast`), on create and SKU-changing update; gaps acceptable. |
| 2026-10-18 | Phase 2: reference validation on product update runs only when the value changes (keeps archived-brand products editable). |
| 2026-10-18 | Phase 2: catalog archive counters live in `products.service` (service-to-service) to avoid a module cycle with `catalog.service`. |
| 2026-10-18 | Phase 2: products routes are `catalog/products/index.tsx` + thin `products.tsx` layout (flat-file children need the parent `Outlet`). |
| 2026-10-18 | Console money rendering: `formatGhs` / `parseGhsToMinor` / `formatMinorPlain` in `admin/src/lib/format.ts`; storage stays integer pesewas. |
| 2026-10-18 | Browser verification uses Playwright with `channel: "chromium"` (cached full build; the headless shell is not installed). |
| 2026-10-18 | Phase 3: branch average cost uses the shared `averageCostAfterReceipt` (weighted integer average, half-up). Receipts blend; adjustments and count variances never change average cost. |
| 2026-10-18 | Phase 3: posting is single-writer per product/branch — `lockOrCreateLevel` (upsert + `FOR UPDATE`) with products locked in sorted order; no deadlocks (concurrency test). |
| 2026-10-18 | Phase 3: short-close records status/note/closer with no stock movement — dispatched stock simply never arrives; destination discrepancies are the destination's problem, losses at source are adjustments. |
| 2026-10-18 | Phase 3: transfer authority is side-scoped — dispatch/cancel belong to the source branch, receive/short-close to the destination; the other side sees 403. |
| 2026-10-18 | Phase 3: count snapshots copy the level book at open; posting writes only variance movements (counted − snapshot) and refuses negative results (409, naming products). |
| 2026-10-18 | Phase 3: product archive requires zero stock everywhere (409 otherwise); warehouses cannot host POS terminals (409). |
| 2026-10-18 | Phase 3: movements carry `reference_number` (GRN/TRF/CNT, null for adjustments) so offline history reconciles without joins (Phase 6 contract). |
| 2026-10-18 | Phase 3: receipts record supplier name + invoice now; the payable row is created in Phase 5 from the same receipt (`payable` table does not exist yet). |
| 2026-10-18 | Phase 4: customer creation records the creating branch; admins must pass `branchId`, managers default to their own branch. |
| 2026-10-18 | Phase 4: customer search is `q` + `page`/`pageSize` (default 20); `includeArchived` and `branchId` filters are admin-only, managers search globally. |
| 2026-10-18 | Phase 4: anonymization requires zero credit balances (all branches) and zero loyalty points; it scrubs PII in place, keeps the ledgers, and releases the phone for re-registration. |

---

## Open Items (carry forward)

- **No git remote yet** — push `dev`, add `staging`/`main`, and watch the CI workflow run
  on GitHub (workflow is written and locally verified).
- Phase 5 must create payables from existing receipts: Phase 3 stores supplier name +
  invoice number on the receipt; the `payable` table does not exist yet.
- Human verification from Plan 04: TOTP with an authenticator app is now machine-verified
  end to end (browser walkthrough performs forced setup + verification). Remaining: a
  human visual pass over the Phase 2 console screens and the dev-mail password-reset
  flow (Phase 1 list).
- GRA E-VAT onboarding: credentials, QR encoding, submission API shape (mock until then).
- Paystack registered business and keys; `PAYSTACK_MODE=mock` until then.
- VPS provider, domain, and DNS (Phase 9 setup gate).
- Windows code-signing certificate (Phase 9; unsigned builds first).
- PowerSync Cloud account + two instances (staging/prod) before Phase 6 human verification.
- Physical hardware for human verification: ESC/POS printer, keyboard-wedge scanner, cash drawer.
- Cosmetic: console `favicon.ico` is a 404 (Phase 9 polish).

---

## Session Notes

- Load `gsd` and `owasp-security` before every planning or building task; load
  `powersync`, `hono`, `better-auth-*`, and `supabase-postgres-best-practices` when the
  task touches those areas.
- Plans are prompts. Implement one task at a time and commit atomically.
- Stop and ask before decisions that affect money, credit, stock, loyalty, permissions,
  or production infrastructure.
- The API runs TypeScript directly on Node 24 (`node src/index.ts`); keep source free of
  TS enums, namespaces, and parameter properties.
- Branch code suggestions use first/second/last consonant for long area names
  (Spintex → SPX, Adum → ADM); codes stay editable before save.
- Root scripts: `bun run db:up`, `dev:api`, `dev:admin`, `lint`, `check-types`, `test`,
  `build`, `db:generate`, `db:migrate`, `db:seed`, `db:test:prepare`.
- Run `bun run db:test:prepare` after migrations before running API tests; integration
  suites are skipped when the test database is unreachable.
- Email: console provider in dev (recipients redacted, bodies not logged); the file
  provider (`api/.mail/`) exists in development; temp passwords are returned once in API
  responses and emailed, never logged.
- Regenerating `packages/db/src/schema/auth.ts` with the Better Auth CLI will overwrite
  manual hardening; re-apply and regenerate a migration afterwards.
- New API modules: copy the seven-file layout documented in AGENTS.md. Pure scope
  helpers live in `api/src/auth/scope.ts`; request context adapters in `api/src/http/`.
- Phase 2 modules: `api/src/modules/catalog` (category/brand/uom + schema) and
  `api/src/modules/products` (product/barcode/price + guard counters). Cross-module
  calls: `catalog.service` → `products.service` (counts); `products.service` →
  `catalog.repository` (ref lookups) — keep it acyclic.
- Sequences: `allocateFromSequence` (consumes), `peekSequenceValue` (peeks),
  `advanceSequencePast` (syncs after an explicit `PREFIX-#####` value was saved) in
  `api/src/modules/platform/settings.service.ts`.
- Integration test fixtures seed catalog rows directly via Drizzle when the API under
  test does not own them; track every created id for scoped cleanup (other suites run
  in parallel against `gikautos_test`).
- Walkthrough scripts (API + Playwright browser) live under
  `.planning/phases/02-catalog-pricing/evidence/`; run them against a running
  API (`:4000`) and console (`:3000`). The browser script auto-handles forced TOTP
  setup, storing the dev secret at `/tmp/opencode/admin-totp.json`.
- Phase 3 posting is a single service path: `postMovements` in
  `api/src/modules/inventory/inventory.service.ts` (sorted locks via
  `lockOrCreateLevel`; receipts, adjustments, transfers, and counts all go through it) —
  keep every future write path (POS sales) on it.
- Phase 3 evidence scripts: `.planning/phases/03-inventory-transfers/evidence/`
  (`walkthrough-inventory.mjs`, `smoke-console.mjs`, `smoke-transfers-counts.mjs`); run
  the browser scripts from a directory where `playwright` resolves and point `SHOTS_DIR`
  at the `evidence/` folder.
- Phase 6 contracts to honour: extend `StockMovementType` (e.g. `SALE`) and add an
  oversell posting mode; keep movements append-only, `reference_number` populated, and
  the ledger-invariant test green.
- Admin console: server functions live in `admin/src/lib/*.functions.ts`; the session
  guard is `admin/src/routes/_authenticated/route.tsx`; permission helpers in
  `admin/src/lib/role.ts`; API client + types in `admin/src/lib/api.ts` / `api-types.ts`
  (hand-maintained). Catalog screens under `admin/src/routes/_authenticated/catalog/`;
  shared dialogs under `admin/src/components/catalog/`.
- Long-running dev servers in this environment: start with
  `(setsid nohup bun run dev > log 2>&1 < /dev/null &)` and kill with
  `pkill -f "[v]ite dev"` (bracket pattern avoids killing the calling shell).
- Better Auth CSRF: browser requests carry `Origin`; scripted clients must send a trusted
  `Origin` header on POSTs or the API rejects with `MISSING_OR_NULL_ORIGIN`.
- Phase 4: `writeAudit(entry, executor)` takes the executor as its second positional
  argument. Sequence assertions in tests stay format-based (e.g. `/^REP-\d{5}$/`) because
  the platform suite advances global sequences and test files run in parallel.
- Phase 4: customer archive/anonymize POST bodies are `{}` or `{ "note": "…" }`; the
  customer module owns bootstrap of the `loyalty_account` row (schema import only, no
  loyalty-module dependency) per D22.
