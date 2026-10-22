# STATE — GikAutos v1

**Milestone:** v1
**Updated:** 2026-10-22
**Status:** Phase 5 complete and verified (7/7 plans). **Phase 6 (POS Offline Core) is
planned**: 9 plans covering schema/shared cart math/settings, the hardened Electron shell
and PowerSync spike, device auth and sync streams, offline PIN/bindings and shifts, the
idempotent server sale application, the selling UI, receipts/ESC-POS printing, the durable
outbox/uploader, and verification. See
`.planning/phases/06-pos-offline-core/00-CONTEXT.md` and `01-RESEARCH.md`.
**Next action:** Execute **Phase 6 Plan 01** (schema, shared cart math, settings,
permissions, demo seed).

---

## Progress

| Phase | Name | Status |
|---|---|---|
| 0 | Planning & decisions | ✅ Complete |
| 1 | Foundation & Platform | ✅ Complete (4/4 plans, verified) |
| 2 | Catalog & Pricing | ✅ Complete (6/6 plans, verified) |
| 3 | Inventory & Transfers | ✅ Complete (8/8 plans, verified) |
| 4 | Customers, Credit & Loyalty | ✅ Complete (8/8 plans, verified) |
| 5 | Suppliers & Payables | ✅ Complete (7/7 plans, verified) |
| 6 | POS Offline Core | 📝 Planned (9 plans) |
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
| 03 | Credit module — profiles, ledger, enforcement, repayments, aging, statements | ✅ Complete |
| 04 | Loyalty module — account, ledger, lots, FEFO, expiry engine | ✅ Complete |
| 05 | pg-boss jobs infrastructure and the loyalty expiry schedule | ✅ Complete |
| 06 | Console — customers, credit ledger, repayments, statements, aging | ✅ Complete |
| 07 | Console — loyalty history, liability report, and settings | ✅ Complete |
| 08 | Phase 4 verification and state update | ✅ Complete |

### Phase 5 plan progress

| Plan | Title | Status |
|---|---|---|
| 01 | Phase 5 schema, receipt link, settings, permissions, and demo seed | ✅ Complete |
| 02 | Suppliers module — master, payment details, supplied products, last cost | ✅ Complete |
| 03 | Payables module — invoices from receipts and standalone, totals, voids | ✅ Complete |
| 04 | Payments, allocations, voids, balances, aging, and reconciliation | ✅ Complete |
| 05 | Console — suppliers section, payment details, supplied products | ✅ Complete |
| 06 | Console — invoices, payments, aging, and goods-receipt linking | ✅ Complete |
| 07 | Phase 5 verification and state update | ✅ Complete |

### Phase 6 plan progress

| Plan | Title | Status |
|---|---|---|
| 01 | Phase 6 schema, shared cart math, settings, permissions, and demo seed | 📝 Planned |
| 02 | Desktop shell, Electron security, keychain, and PowerSync spike | 📝 Planned |
| 03 | Device auth, PowerSync sync config, local schema, and connector | 📝 Planned |
| 04 | Offline PIN, device bindings, shifts, and console PIN reset | 📝 Planned |
| 05 | Server sale application, upload endpoint, conflicts, and reconciliation | 📝 Planned |
| 06 | POS selling UI — catalog, cart, customers, credit, loyalty, discounts | 📝 Planned |
| 07 | Sale completion, receipts, ESC/POS printing, and cash drawer | 📝 Planned |
| 08 | Outbox uploader, retries, sync status, and conflict surfacing | 📝 Planned |
| 09 | Phase 6 verification and state update | 📝 Planned |

---

## Repository State

- Fresh git history on `dev`; planning + Phase 1 committed. **No git remote exists yet.**
- Root Bun workspace with catalogs; `@gikautos/shared` (roles, permissions, branch
  codes) and `@gikautos/db` (Drizzle client, config, migrations).
- API boots on Node 24 with native TypeScript type stripping: `bun run dev:api`.
  Validated env, pino logs, request IDs, security headers, CORS, `/health`, `/ready`.
- PostgreSQL: the operator's **local instance on `:5432`**. `gikautos_test` holds the
  current v1 schema (migrated clean after verification). The local `gikautos` database is
  the **discarded prototype schema** (PascalCase tables) and must not be used for v1;
  create a dedicated v1 dev database (the `gikautos` role currently lacks `CREATEDB`) or
  use the Docker stack. `compose.yaml` remains for CI/Docker (host `:5433`,
  `wal_level=logical`, 10 slots for Phase 6). Migrations need an explicit `DATABASE_URL`;
  tests honour `TEST_DATABASE_URL`.
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
- Tests: `bun run test` — shared 56/56, api 276/276 against `gikautos_test`
  (`TEST_DATABASE_URL`; migrate it first).
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

### Phase 4 additions

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
- Credit module (`api/src/modules/credit`): one write path `postEntry` — locks the
  customer+branch profile `FOR UPDATE` (upsert-then-lock, Phase 3 D16 pattern), applies
  kind rules (CHARGE positive with reason; REPAYMENT/REFUND negative; ADJUSTMENT signed;
  method required for repayments), enforces hold (409) and limit (`balance + amount >
  limit` → 409 unless a `credit.override`-permitted user records `overrideReason` /
  `overriddenBy`), allocates `REP-#####`, writes the append-only entry, projects
  `balanceMinor = balance + amount`, and audits (`credit.charge/repayment/refund/
  adjustment`, plus a second `credit.override` row when applied). Idempotent per
  `(branchId, idempotencyKey)` — pre-check plus unique-violation replay inside the
  transaction (parallel same-key race returns one row).
- Credit reads: `listProfiles` / `listEntries` (branches resolved via
  `resolveBranchFilter`), pure `settleCharges` (oldest-first application of negative
  entries to charges, exposing unapplied overpayment) used by `getAging` (fixed buckets
  Current / 1–30 / 31–60 / 61–90 / 90+ from the due date; only non-zero outstanding;
  branch totals = sum of customer rows; admin sees every branch separately) and
  `getStatement` (opening = sum before `from`; ranged entries; closing = opening +
  ranged, reconciling to `balanceMinor`; aging snapshot as of `to`; 404 without a
  profile; admins must name `branchId`). Console printing is Plan 06.
- Repayment API accepts positive amounts (`POST /api/credit/repayments`) and stores them
  negative; charges/refunds/adjustments post through `POST /api/credit/entries` — two
  routes so kind-dependent permission middleware (`credit.repayment` vs `credit.adjust`)
  stays at the edge, with the override re-checked fail-closed in the service.
- Routes: `GET/PUT /api/credit/profiles(/:customerId)`, `POST /api/credit/repayments`,
  `POST/GET /api/credit/entries`, `GET /api/credit/aging`,
  `GET /api/credit/statements/:customerId` wired in `app.ts`.
- Loyalty module (`api/src/modules/loyalty`): one write path `postEntry` — locks the
  global account `FOR UPDATE` (upsert-then-lock, D16), computes EARN points
  `floor(netPaidMinor × loyalty.earnPointsPerCedi / 100)` (floor per sale, no carry —
  a sale below one point writes nothing), requires REDEEM ≥ `loyalty.minimumRedeemPoints`
  and ≤ balance (409 otherwise), stores redemptions/clawbacks negative, consumes live lots
  earliest-expiry-first with per-lot `loyalty_lot_consumption` rows (lots locked
  `FOR UPDATE` ordered `(expiresAt, earnEntryId)`), creates a lot for every positive
  posting (`expiresAt = occurredAt + loyalty.expiryMonths`), allows clawback shortfall as
  a negative balance with lots clamped at zero, projects the balance, audits
  (`loyalty.earned/redeemed/clawback/adjusted`), and replays idempotently per
  `(branchId, idempotencyKey)` — pre-check plus unique-violation replay. `expireDueLots(now)`
  expires per account in one transaction (single global EXPIRE entry with
  `branchId`/`createdBy` null plus consumption rows) and no-ops on a second run; audit
  `loyalty.expiry_run`.
- Loyalty reads: `getAccountDetail` (global — one balance across branches; account
  bootstrapped if missing) and `getLiability` (outstanding points + GHS value at the
  current rate, per-branch activity totals for the range, negative balances — managers
  scoped to their own branch activity plus their customers, admins to all), plus read-only
  `reconcileAccounts` proving `balance = Σ deltas` and
  `lots remaining = Σ positive deltas − Σ consumed` across every account.
- Loyalty routes: `GET /api/loyalty/accounts/:customerId` (`loyalty.read`),
  `POST /api/loyalty/entries` (`loyalty.adjust` — the staff path Phase 6/7 POS flows
  reuse), `GET /api/loyalty/liability` (`loyalty.read`) wired in `app.ts`; redeem quote
  250 pts = GHS 2.50 (250 pesewas) at the 100 pts/GHS default.
- Jobs (`api/src/jobs/`): pg-boss 12 against the API database (own `pgboss` schema,
  installed on first boot with start retries). Started after the HTTP server with
  pino-bridged `error`/`warning` events; `loyalty-expiry` worker calls `expireDueLots()`
  and logs the `{ accounts, lots, points }` summary; schedule `5 0 * * *` in
  `Africa/Accra` with `missed: 'once'` catch-up; graceful shutdown stops jobs first
  (5s grace) then closes the pool. `POST /api/loyalty/expiry-run` (admin-only,
  `loyalty.settings`) runs the same seam synchronously, returns the summary, and the
  engine writes one `loyalty.expiry_run` audit row per run.
- Console (Plan 06, `admin/src/components/customers/`): Customers section — list with
  search + archived toggle, create/edit dialogs; profile with Overview / Credit / Ledger
  tabs; credit settings, repayment (REP toast, received-by from the session), and entry
  dialogs (kind-specific reason sets, live headroom hint, 409-driven override block
  re-submitted as `override: { reasonCode, note }`); printable A4 statement rendering the
  exact API payload (`statement-view.tsx`); aging tab (manager's branch fixed, admin
  all-branches or one, as-of date, zero buckets muted); archive/reactivate/anonymize with
  a live zero-balance checklist and server 409s surfaced readably. Money dialogs keep one
  idempotency key per form session (kept on network failure, cleared on any API response).
- Console (Plan 07): loyalty tab on the customer profile (`loyalty-card.tsx`,
  `loyalty-adjust-dialog.tsx`, `loyalty-history-table.tsx`) — global balance with implied
  GHS value at the current rate, expiring-soon total, live lots with FEFO order and
  "in N days" hints, full history (kind badges, signed points, reason, branch, reference);
  adjust dialog (Earn from amount paid / Redeem with quoted value and minimum hint /
  Clawback pinned to RETURN with negative-balance warning / Adjust with reason) whose
  server 409s (minimum, insufficient balance) surface inline; liability page
  (`routes/_authenticated/loyalty.tsx`, `liability-report.tsx`, sidebar `Gift`) — headline
  cards (outstanding, GHS liability, expiring in 30 days), per-branch activity table with
  net check, negative-balance review list linking to profiles; Settings Loyalty/Credit
  groups (minimum redemption, repayment prefix/sequence; earn rate now integer-only).
  The liability API gained `expiringSoonPoints` (remaining live lots expiring within 30
  days).
- Verification: fresh-DB cycle (volume reset → migrate → seed → demo seed; TOTP
  re-bootstrapped), HTTP + SQL walkthrough **154/154** (FIFO reconstruction, statement and
  aging arithmetic incl. an as-of date, FEFO consumption rows, expiry job + idempotent
  second run, liability + activity, branch scoping 403s, anonymization guards, credit and
  loyalty reconciliation SQL, audit coverage), browser walkthrough **29/29** with
  screenshots; scripts and evidence under
  `.planning/phases/04-customers-credit/evidence/`, verification record in
  `01-VERIFICATION.md`.

---

### Phase 5 additions

- Schema (migrations `0005_peaceful_synch.sql` for suppliers, `0006_calm_swarm.sql` for
  payables + `stock_receipt.supplier_id`): `supplier` (global master, `SUP-#####`,
  ACTIVE/ARCHIVED, trigram name index), `supplier_payment_detail` (BANK/MOMO, one active
  default per supplier via partial unique index, nullable `paystack_recipient_code`),
  `supplier_product` (unique supplier+product, one preferred supplier per product),
  `supplier_invoice` (+ lines; status OPEN/PARTIAL/PAID/VOID; supplier number unique per
  supplier+branch among non-VOID; one invoice per receipt; branch idempotency key),
  `supplier_payment` (+ append-only `supplier_payment_allocation`: positive APPLY, negative
  RELEASE with `reverses_allocation_id`; branch idempotency key).
- Settings: `supplier.codePrefix`/`codeSequence`, `payable.invoicePrefix`/`invoiceSequence`,
  `payable.paymentPrefix`/`paymentSequence` (defaults SUP/SINV/PAY, pad 5, allocated via
  `allocateFromSequence`).
- Permissions: `supplier.read` (admin+manager) and admin-only `supplier.create/update/
  archive`; `payable.read/invoice.manage/payment/void` (admin all; manager branch-scoped);
  cashier none.
- Demo seed: SUP-00001 Accra Parts Depot (bank + MoMo default), SUP-00002 GikAutos Imports
  (MoMo); receipt links for GRN-00001/00002; four product mappings with last costs;
  `SINV-00001` from GRN-00002 with the derived split and a 40% `PAY-00001`; standalone
  freight `SINV-00002`; `PAY-00002` on account; sequences advanced to 3. Fully idempotent.
- Suppliers module (`api/src/modules/suppliers`): search by name fragment/code (archived
  hidden unless admin), create allocates `SUP-#####` and normalises the phone, archive
  blocked while owed ≠ 0 (409 names the amount), reactivate, payment details with
  default-switch/deactivate semantics and masked account numbers, product mappings with the
  joined product view, and `recordInvoiceCosts` refreshing `last_cost` from invoice lines.
- Payables module (`api/src/modules/payables`): `createInvoice` (receipt copy or standalone
  lines; omitted tax ⇒ `taxBreakdown(STANDARD, INCLUSIVE)` so the total equals the entered
  tax-inclusive costs; provided tax ⇒ net lines + manual split; server-recomputed totals;
  supplier row locked; idempotency replay checked before unique-violation mapping; one
  invoice per receipt), `voidInvoice` (only at zero net allocation), `createPayment`
  (dedupe allocations, Σ ≤ amount, outstanding/supplier/VOID/branch guards, sorted invoice
  locks, on-account remainder, status recompute), `voidPayment` (RELEASE rows + invoice
  flips + audit), payment reads with allocated/on-account totals, `getAging` (fixed buckets,
  as-of, on-account separate), `listSupplierBalances` (outstanding − remainder per supplier),
  and `reconcilePayables()` (invoice paid = signed allocations, status derivation, VOID at
  zero, owed = independent `sumSupplierOwed`).
- Routes: `/api/suppliers…` (list, create, get, patch, archive, reactivate, payment details,
  products) and `/api/payables…` (invoices list/create/get/void, payments list/create/get/
  void, balances, aging), wired in `app.ts`.
- Console: Suppliers section (Truck icon) with Suppliers / Invoices / Payments / Aging tabs;
  supplier list + form dialog, detail (overview, payment details with default/deactivate,
  supplied products with last cost); invoice list with filters and overdue tint, invoice
  form (receipt picker, product/free-text lines, derived/zero/manual tax panel, live totals,
  idempotency key) and detail (lines, tax split, linked receipt, allocations, record payment,
  void); payment list/form (allocation editor with oldest-first and on-account remainder),
  payment detail and void dialog with release preview; aging page with summary cards and
  totals row; supplier list owed column fed by balances. Inventory gains the Receipts tab,
  receipt detail with "Record supplier invoice", and a supplier picker (free-text fallback)
  in the receive dialog. Settings shows the Suppliers & Payables group.
- Verification follow-ups committed during the phase: `ca41b50` payment list rows carry
  supplier/branch names; `9bd652a` product mapping mutations return the joined view;
  `951499f` invoice list filters by `receiptId`; admin `ApiError.details` surfaces the
  duplicate-invoice/archived ids for inline links.
- Tests: suppliers suite 15/15, payables service 19/19, payables HTTP 5/5; the phase adds
  **41** API tests (235 → 276). Phase 5 verification: API/SQL 102/102, console 25/25.

### Phase 6 planning additions (2026-10-22)

- Phase 6 is **planned only** (9 plans, waves 1–6). Artifacts:
  `phases/06-pos-offline-core/00-CONTEXT.md` (D1–D36), `01-RESEARCH.md`, `01-PLAN.md` …
  `09-PLAN.md`.
- Locked mechanics worth carrying into execution: terminal-scoped offline receipt numbers
  (`${terminal.code}-${YYYYMMDD}-${NNNN}`); local-only tables + our own outbox (PowerSync
  downloads only, no CRUD `uploadData`); charged amounts are sale facts and price/total
  drift becomes a conflict, never a repricing; `SALE` stock movements use
  `postMovements(..., { allowNegative: true })`; credit/loyalty replay uses internal
  bypass options on `postEntry`; one `pos_sync_transaction` row per client transaction for
  exactly-once; the shared `priceCart` in `@gikautos/shared` is the only pricing path.
- Research deltas since the 2026-10-17 notes: Forge is now **8.0.1** (ESM-only, Vite
  plugin stable on Vite 8, `.cjs` main/preload); Electron is **45** (sync `safeStorage`
  deprecated, async only); PowerSync Web SDK is **2.5.0** (ESM-only, HTTP streaming,
  `syncStream`, local-only tables); Bun's self-contained workspace
  (`installConfig.hoistingLimits: "workspaces"`) is the Forge packaging fix.
- Desktop architecture: Electron Forge 8 + Vite 8 + React 19 + hash routing +
  `app://` secure protocol + strict CSP + fuses + async `safeStorage`; `@maxxuxx/node-printer`
  for Windows spooler RAW/ESC-POS behind a printer port with a fake adapter for CI.
- Verification gates: Plan 02's PowerSync-in-Electron spike must pass before UI work;
  Plan 09 needs a fresh Docker DB, the self-hosted PowerSync Docker service (`bun run
  sync:init` / `sync:up`), a two-device last-unit race, duplicate-upload drill, Electron
  E2E with fake printing, and an unsigned Windows installer.




| Date | Decision |
|---|---|
| 2026-10-17 | The earlier prototype and its planning are discarded; fresh git history on `dev`. |
| 2026-10-17 | v1 scope: POS + back office + inventory + suppliers + credit + loyalty + Paystack. E-commerce, delivery, payroll, GL, AI, fitment, and mobile are out of scope. |
| 2026-10-17 | API: Hono + Drizzle + Better Auth on Node 24. |
| 2026-10-17 | Offline sync: PowerSync Cloud (Free → Pro), Web SDK in the Electron renderer. **Superseded for development on 2026-10-22: self-hosted Docker service; production target open for Phase 9.** |
| 2026-10-17 | Database: PostgreSQL 17 on a VPS via Docker; PowerSync Cloud connects over TLS with an IP allowlist. **(Cloud path retained for the Phase 9 production decision; dev/CI self-hosted.)** |
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
| 2026-10-19 | Phase 4 Plan 03: repayments are accepted positive at the HTTP edge and stored negative; charges are positive, refunds negative, adjustments signed. A single service path (`postEntry`) keeps one semantic. |
| 2026-10-19 | Phase 4 Plan 03: credit profiles are created lazily (upsert-then-lock) by the first settings change or posting; the default limit is 0, so charges need a manager to raise the limit first. |
| 2026-10-19 | Phase 4 Plan 03: a hold blocks new CHARGE only (collections stay open); anonymized customers accept no credit writes at all; archived customers block charge but allow repayment. |
| 2026-10-19 | Phase 4 Plan 03: an over-limit override writes two audit rows — the posting plus `credit.override` (reason, note, approver, limit snapshot). Aging buckets are fixed from the due date and only non-zero outstanding appears; statement closing is computed as opening + ranged so it reconciles by construction. |
| 2026-10-19 | Phase 4 Plan 04: earn is floor per sale with no carry (`floor(netPaidMinor × rate / 100)`); a sale below one point writes nothing. Redemptions are accepted positive at the HTTP edge, stored negative, and require ≥ `loyalty.minimumRedeemPoints` and enough balance (409). EARN carries the net amount paid; the engine computes points. |
| 2026-10-19 | Phase 4 Plan 04: redemption and clawback consume lots earliest-expiry-first; a clawback shortfall leaves the balance negative with lots clamped at zero (surfaced in the liability negative-balances list). Positive adjustments create a lot so expiry stays total; ADJUST is reason-coded, CLAWBACK is always RETURN, and EXPIRE is engine-only (`branchId`/`createdBy` null), one entry per account per run, idempotent across runs. |
| 2026-10-19 | Phase 4 Plan 04: reconciliation compares each projection to its ledger sum and lot remainders to positive backing − consumption; the liability value uses `floor(points × 100 / pointsPerCedi)`. Liability scoping: outstanding is global (all-branch), activity rows are manager-scoped plus global expiry rows, negative balances are manager-scoped by customer branch. |
| 2026-10-19 | Phase 4 Plan 05: background jobs run on pg-boss 12 against the API database (own `pgboss` schema); the loyalty expiry worker is the only queue so far. The schedule fires daily at 00:05 Africa/Accra with `missed: 'once'` so an outage catches up on boot; jobs start after HTTP listening and stop before the DB pool closes. |
| 2026-10-19 | Phase 4 Plan 05: the admin expiry trigger is `POST /api/loyalty/expiry-run` gated by the admin-only `loyalty.settings` permission; it calls the same `expireDueLots()` seam directly (no queue hop) so operators get an immediate, audited summary. |
| 2026-10-19 | Phase 4 Plan 06: console money dialogs keep one idempotency key per form session — kept on network failure, cleared on any API response — so retries never double-post while a corrected entry stays possible. |
| 2026-10-19 | Phase 4 Plan 06: statements print from the same API payload through a dedicated A4 print stylesheet (`@media print`, app shell hidden) rather than a second document generator. |
| 2026-10-19 | Phase 4 Plan 07: "expiring soon" is the sum of remaining live lot points expiring within 30 days; the liability headline value is `floor(points × 100 / pointsPerCedi)` and is legitimately negative when clawback shortfalls exist. |
| 2026-10-19 | Phase 4 Plan 08: verification runs the API/SQL walkthrough first on a fresh volume, then the browser walkthrough against the same data; exact REP numbers and staff emails are asserted by design, so `walkthrough-phase4.mjs` is fresh-DB-only and documented as such. |
| 2026-10-19 | Phase 4 Plan 08: a deactivated staff session fails closed with 401 (the session no longer resolves); the walkthrough asserts the lockout without depending on the exact status code. |
| 2026-10-22 | Phase 5 implements D1–D18 as locked. Specific mechanics: invoice unit costs are tax-inclusive when the tax fields are omitted (derived STANDARD 20% split, total = entered costs); sending tax fields switches the lines to net amounts and `total = subtotal + vat + nhil + getfund`. |
| 2026-10-22 | On-account payment remainders are never netted into aging buckets; they reduce the supplier's owed balance and appear as a separate "On account" figure. Aging uses the current due dates shifted by the as-of parameter (not a historical allocation snapshot), mirroring Phase 4 credit aging. |
| 2026-10-22 | A voided invoice keeps occupying its receipt slot (one invoice per receipt); voiding frees only the supplier's invoice number for re-entry. Payment voids are append-only RELEASE rows and never delete APPLY history. |
| 2026-10-22 | Supplier creation/archiving and invoice/payment creation serialize on the supplier row (`FOR UPDATE`), so archiving cannot race a new debt; allocation payments lock invoice rows in id order so parallel payments cannot over-apply. |
| 2026-10-22 | Console money forms keep one idempotency key per form session (kept on network failure, cleared on any API response), the Phase 4 pattern. |
| 2026-10-22 | Verification runs on the operator's **local PostgreSQL `:5432`** (`gikautos_test`, schema reset because the role lacks `CREATEDB`), not Docker; tests use `TEST_DATABASE_URL`. The walkthrough is fresh-DB-only and asserts the seeded starting points (`SUP-00001/2`, `SINV-00001/2`, `PAY-00001/2`, sequences = 3). |
| 2026-10-22 | Phase 5 verification fixes kept: payment list rows carry supplier/branch names; supplier-product create/update return the joined product view; invoice lists filter by `receiptId`; the admin client surfaces API error `details`. |
| 2026-10-22 | Phase 6: development and CI use the **self-hosted PowerSync Docker service** (pinned `journeyapps/powersync-service` stable tag, `-r unified`) against the Docker Postgres, with Postgres bucket storage and the API JWKS. **Staging and production use PowerSync Cloud** (two instances) with the same sync config; no Cloud account is needed for development. |

---

## Open Items (carry forward)

- **No git remote yet** — push `dev`, add `staging`/`main`, and watch the CI workflow run
  on GitHub (workflow is written and locally verified).
- Phase 4 and Phase 5 are verified (`phases/04-customers-credit/01-VERIFICATION.md`,
  `phases/05-suppliers-payables/01-VERIFICATION.md`). The verification fixtures live in the
  local `gikautos_test` database; reset + reseed it before a demo and rerun the admin TOTP
  bootstrap afterwards.
- Phase 5 verification used `gikautos_test`. The local `gikautos` database on `:5432` is
  the **discarded prototype schema** (PascalCase tables), not the v1 schema; do not point
  v1 at it. Create a dedicated local v1 dev database (grant `CREATEDB` or run
  `createdb` as `postgres`) or use the Docker stack, then migrate + seed.
- Phase 8: Paystack transfers consume `supplier_payment_detail.paystack_recipient_code`
  and the reserved `PAYSTACK` payment method; E-VAT purchase reporting uses the stored
  VAT/NHIL/GETFund split. Receipts and payables-aging exports are Phase 8 scope.
- Human verification from Plan 04: TOTP with an authenticator app is now machine-verified
  end to end (browser walkthrough performs forced setup + verification). Remaining: a
  human visual pass over the Phase 2 console screens and the dev-mail password-reset
  flow (Phase 1 list).
- GRA E-VAT onboarding: credentials, QR encoding, submission API shape (mock until then).
- Paystack registered business and keys; `PAYSTACK_MODE=mock` until then.
- VPS provider, domain, and DNS (Phase 9 setup gate).
- Windows code-signing certificate (Phase 9; unsigned builds first).
- PowerSync: development and CI use the **self-hosted official Docker service**
  (`journeyapps/powersync-service`, pinned stable tag, `start -r unified`) against the
  Docker Postgres with logical replication; no Cloud account is needed for Phase 6.
  **Staging/production use PowerSync Cloud** (two instances) with the same
  `sync-config.yaml`; the Cloud project/instances are a Phase 9 setup gate.
- Phase 6: Forge/Bun packaging and the PowerSync-in-Electron spike must pass before UI
  work; the Windows Squirrel installer job needs a git remote (or a manual
  `windows-latest` run) before it can be proven.
- Physical hardware for human verification: Windows terminal, ESC/POS printer, keyboard-wedge
  scanner, cash drawer (Phase 6 checklist).
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
- Phase 5 evidence: `.planning/phases/05-suppliers-payables/evidence/` holds
  `walkthrough-payables.mjs` (HTTP + SQL, 102 checks) and
  `smoke-console-suppliers.mjs` (Playwright, 25 checks, 18 screenshots) with their logs.
  Both are **fresh-DB-only** (exact `SUP-00003/4`, `SINV-00003`, `PAY-00003` assertions).
  Rerun cycle on the local instance: reset the `gikautos_test` schema, migrate, `db:seed`,
  `db:seed --demo` twice, start the API with that `DATABASE_URL`, bootstrap TOTP, run the
  API walkthrough, then the browser script from a directory where `playwright` resolves
  (`SHOTS_DIR` pointing at `evidence/`). Tests use `TEST_DATABASE_URL`.
- Phase 5 invariants to preserve: invoices and payments have one write path
  (`createInvoice`, `createPayment`); allocations are append-only signed rows; invoice
  `amount_paid_minor`/status are projections recomputed in the same transaction; supplier
  rows lock before debts/archive; totals are always server-computed; account numbers stay
  masked outside the owning supplier detail payload.
- `bun run db:test:prepare` is Docker-specific; on the local instance, create/migrate
  `gikautos_test` directly (the role lacks `CREATEDB`, so reset the schema instead of
  dropping the database).
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
- Phase 4: every credit write goes through `postEntry` in
  `api/src/modules/credit/credit.service.ts` (profile locked `FOR UPDATE`; kind rules,
  enforcement, REP allocation, balance projection, audit). `settleCharges` is pure and
  shared by aging and statements; `balance_minor = SUM(amount_minor)` is test-enforced,
  including parallel refunds and same-key replay.
- Phase 4: `credit.service` calls `requireCustomer` (customers.service) for identity —
  service-to-service keeps the customers → loyalty bootstrap and credit → customers
  dependency direction acyclic (D22).
- Phase 4: customer archive/anonymize POST bodies are `{}` or `{ "note": "…" }`; the
  customer module owns bootstrap of the `loyalty_account` row (schema import only, no
  loyalty-module dependency) per D22.
- Phase 4: every loyalty write goes through `postEntry` in
  `api/src/modules/loyalty/loyalty.service.ts` (account locked `FOR UPDATE`, a lot per
  positive posting, FEFO consumption ordered `(expires_at, earn_entry_id)`, balance
  projection, audit). `expireDueLots` is the seam Plan 05 schedules; read-only
  `reconcileAccounts` backs the journey test and the Phase 8 reports — keep both green.
- Phase 4: loyalty settings stay at defaults in tests (`earnPointsPerCedi` 1,
  `pointsPerCedi` 100, `expiryMonths` 12, `minimumRedeemPoints` 100); platform tests only
  read them or reject invalid writes, so no suite should mutate global loyalty settings.
- Phase 4: loyalty reads are global, but `getLiability` activity is manager-scoped
  (own branch plus branch-less EXPIRE rows); tests assert per-branch totals only for
  their own uniquely-coded branches because all suites share `gikautos_test`.
- Phase 4: pg-boss lives in `api/src/jobs/` (`boss.ts` singleton, `queues.ts`
  queue/worker/schedule, `index.ts` start/stop); tests import `app.ts` only, never
  `src/index.ts`. The loyalty job test starts its own instance against the test DB with
  `schedule: false` + `__test__enableSpies` and unschedules/stops in `afterAll`. A dev
  server under `node --watch` restarts into the jobs code automatically; two API
  instances share the `pgboss` schema safely.
- Phase 4 console: print support = `@media print { @page A4 }` in `admin/src/styles.css`
  plus `print:hidden` on the app shell and the customers layout; verify print output with
  Playwright's `page.emulateMedia({ media: "print" })`.
- Phase 4 console: while a Radix dialog is open it marks the rest of the page
  `aria-hidden`, and Playwright's `getByRole` excludes aria-hidden content while
  `getByText` does not — wait for dialogs to close before counting role-based locators.
- Phase 4 smokes seed fixtures through the real API (a fresh customer per run stays
  rerunnable) and may tweak non-reconciled columns directly for edge states (e.g.
  `loyalty_lot.expires_at` into the 30-day window) — the ledgers stay truthful because
  expiry dates are not part of reconciliation.
- Phase 4 evidence scripts: `.planning/phases/04-customers-credit/evidence/`
  (`walkthrough-phase4.mjs`, `smoke-console-credit-loyalty.mjs`). The API walkthrough is
  fresh-DB-only (asserts exact REP numbers and staff emails), restores the demo passwords,
  and must run before the browser walkthrough; the browser script runs from a
  Playwright-capable directory with `SHOTS_DIR` pointed at `evidence/`.
- Phase 4 console: statements print through `@media print` (A4, shell hidden); verify with
  `page.emulateMedia({ media: "print" })` and expect the sidebar to be hidden. Full-page
  screenshots include dialogs; card labels can duplicate page descriptions, so use exact
  text locators for them.
- Phase 6 (planned): load `powersync` before any sync work and re-read
  `phases/06-pos-offline-core/01-RESEARCH.md` — the SDK/Forge/Electron versions moved since
  the original 2026-10-17 research. Development runs the **self-hosted PowerSync Docker
  service** (`sync:init` → `sync:up`), not Cloud. Local-only PowerSync tables are never
  queued for upload; do not "fix" that by making sale/shift tables synced. The only sale
  write path is `pos.service.applySale`; the only pricing path is the shared `priceCart`;
  outbox rows are never deleted before an ack.
- Phase 6 (planned): the desktop workspace must be a self-contained Bun workspace
  (`installConfig.hoistingLimits: "workspaces"`) or Forge packaging will follow symlinks and
  fail. Use `POS_PRINTER_DRIVER=fake` for all automated runs; real hardware is a human
  checklist item. `app://` (not `file://`) is required for PowerSync workers.

