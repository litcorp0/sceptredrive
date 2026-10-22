# REQUIREMENTS — GikAutos v1

**Scope:** v1 = first national-ready release of the platform.
**Rule:** every v1 requirement maps to exactly one phase (see `ROADMAP.md`).

---

## Foundation & Platform (FOUND / ADM shell) — Phase 1

- **FOUND-01** — Bun workspace monorepo (`admin/`, `api/`, `desktop/`, `packages/*`) with one
  root lockfile, shared `tsconfig` base, and Biome lint/format.
- **FOUND-02** — Typed environment configuration validated at boot (Zod), `.env.example`
  template, no secrets committed, safe defaults for local development.
- **FOUND-03** — PostgreSQL 17 via Docker Compose locally; Drizzle schema and versioned
  migrations; seed/bootstrap scripts.
- **FOUND-04** — Hono API skeleton on Node 24: health/readiness, request IDs, structured
  pino logging, central error handling, security headers, CORS allowlist, body limits.
- **FOUND-05** — Better Auth email/password with no public sign-up; admin-created staff
  accounts; password reset; session invalidation; secure cookies.
- **FOUND-06** — TOTP two-factor available for Admin and Manager; admin can require it.
- **FOUND-07** — RBAC: fixed `ADMIN`, `MANAGER`, `CASHIER` roles; server-side permission
  checks on every endpoint; branch scoping enforced for managers.
- **FOUND-08** — Organisation model: company → branch (`RETAIL`/`WAREHOUSE`) → terminal →
  staff; branch CRUD; terminal CRUD.
- **FOUND-09** — Device enrollment: admin generates a one-time terminal enrollment code;
  desktop exchanges it for a device token; devices can be listed and revoked.
- **FOUND-10** — Append-only audit log: actor, action, entity, before/after, branch,
  terminal, timestamp; mutating endpoints write entries automatically.
- **FOUND-11** — Settings store (key/value, optional branch scope) and feature flags.
- **FOUND-12** — Admin shell (TanStack Start): login, protected layout, role-aware
  navigation, branch switcher for admin, loading/empty/error states, shadcn theme.
- **FOUND-13** — CI on PR/push: install, lint, typecheck, tests, builds.
- **FOUND-14** — Transactional email adapter (Resend in production, console in development)
  for invitations, password reset, and account notices.
- **ADM-01** — Role-aware admin navigation shell with exactly one active section and
  no over-broad sections.
- **ADM-09** — Branch switcher and manager branch-only scoping visible in the console.

---

## Catalog & Pricing (CAT / ADM) — Phase 2

- **CAT-01** — Category hierarchy (create, rename, re-parent, archive).
- **CAT-02** — Brand master (create, edit, archive).
- **CAT-03** — Unit of measure master (code, name, active).
- **CAT-04** — Product master: SKU, name, description, category, brand, UOM, cost price,
  base selling price, tax category, active/archived.
- **CAT-05** — Barcode master: one or more unique barcodes per product; duplicate rejected.
- **CAT-06** — Pricing: base price plus optional branch override; manager can only change
  their own branch override; admin can change any.
- **CAT-07** — Ghana tax engine: VAT 15% + NHIL 2.5% + GETFund 2.5% on one base;
  inclusive and exclusive modes; zero-rated and exempt tax categories.
- **CAT-08** — Catalog search and list: by name, SKU, or barcode; paginated; branch-aware
  price preview; active-only by default with an "include archived" toggle.
- **ADM-03** — Catalog console screens for categories, brands, UOMs, products, barcodes,
  and prices with debounced search and validation errors.

---

## Inventory & Transfers (INV / ADM) — Phase 3

- **INV-01** — Immutable stock movement ledger (append-only; no update/delete paths).
- **INV-02** — Stock level projection per branch/product, maintained transactionally;
  `on_hand` always equals the sum of movements.
- **INV-03** — Receive stock: optional supplier details (supplier, invoice number, unit
  cost) create the movement and the supplier invoice in one operation; cost updates the
  branch average cost.
- **INV-04** — Adjustments: reason-coded, permission-checked, audited, posted as
  compensating movements.
- **INV-05** — Inter-branch transfers: `DRAFT → DISPATCHED → RECEIVED` with partial
  receive and discrepancy notes; warehouse ↔ branch and branch ↔ branch.
- **INV-06** — Stock counts: open → count → review → post; variance posted as an adjustment
  with an audit trail.
- **INV-07** — Low-stock thresholds per product/branch and a low-stock list.
- **INV-08** — Stock history for a product/branch showing every movement and reference.
- **INV-09** — Warehouse branch type: stock-only; no POS terminals; excluded from POS sale
  flows and sales reports by default.
- **ADM-04** — Inventory console: stock by branch, movement history, receive, adjust,
  transfers, counts, and low stock.

---

## Customers, Credit & Loyalty (CUS / LOY / ADM) — Phase 4

- **CUS-01** — Global customer identity: name, phone (E.164, unique), email, address;
  searchable by phone/name; created at a branch.
- **CUS-02** — Branch credit profile: credit limit, credit hold, payment terms, notes;
  created and owned by the branch where the customer is enrolled.
- **CUS-03** — Credit ledger: credit sale, repayment, adjustment, refund; append-only,
  idempotency-keyed; balance is a projection.
- **CUS-04** — Credit limit enforcement (online) with a reason-coded manager override.
- **CUS-05** — Record repayments (cash/bank/MoMo) with reference and received-by; POS
  repayment flow is Phase 7.
- **CUS-06** — Customer statement and credit aging per branch/customer; printable.
- **LOY-01** — Global loyalty account per customer; one balance across all branches.
- **LOY-02** — Append-only loyalty ledger plus point lots with expiry dates.
- **LOY-03** — Configurable earn rules; default 1 point per GHS 1 of net merchandise paid
  (excluding tax and redemption).
- **LOY-04** — Configurable redemption; default 100 points = GHS 1, minimum redemption
  setting; redemption applied as a discount before tax.
- **LOY-05** — Expiry job (default 12 months) and loyalty liability report.
- **LOY-06** — Manual loyalty adjustments with reason and permission check.
- **ADM-05** — Customers console: profile, branch credit profile, ledger, repayments,
  loyalty history, statements, limits and holds.

---

## Suppliers & Payables (SUP / ADM) — Phase 5

- **SUP-01** — Supplier master: name, contacts, payment details (MoMo/bank), terms, notes.
- **SUP-02** — Supplier products: supplier SKU ↔ product mapping, last cost, lead time.
- **SUP-03** — Supplier invoices: branch, supplier invoice number, dates, lines, totals,
  amount paid, status (`OPEN`/`PARTIAL`/`PAID`/`VOID`).
- **SUP-04** — Supplier payments: manual cash/bank payments with allocation to one or more
  invoices; Paystack transfers are Phase 8.
- **SUP-05** — Supplier balance owed, payment history, and payables aging per
  supplier/branch.
- **ADM-06** — Suppliers console: master, supplied products, invoices, payments, balances,
  and aging.

---

## POS Offline Core (POS / SYNC) — Phase 6

- **POS-01** — Electron Forge desktop app with secure shell (context isolation, sandbox,
  no node integration, typed preload IPC, CSP) and a Windows installer build.
- **POS-02** — Device enrollment with a one-time code; device token stored in the OS
  keychain; revocation honored.
- **POS-03** — Offline cashier PIN login: Argon2id verifier cached on the device, lockout
  after failed attempts, manager unlock.
- **POS-04** — Shift open/close with opening float, cash in/out, expected vs counted cash,
  and variance; works offline.
- **POS-05** — Sales: barcode scan and search, cart, quantities, line/sale discounts
  (permissioned), and tax computed per line.
- **POS-06** — Cash sales complete fully offline; ESC/POS receipt printing; cash drawer
  kick on cash tender.
- **POS-07** — Credit sales offline within the cached branch limit; over-limit or held
  account requires a manager PIN; server revalidates and records conflicts.
- **POS-08** — Loyalty earn and redeem while offline within the cached balance; redemption
  reduces the sale total as a pre-tax discount.
- **POS-09** — Customer lookup/create at the POS by phone; branch credit profile is
  auto-created for the selling branch.
- **POS-14** — Touch-friendly POS UI, keyboard shortcuts, visible offline/sync status,
  pending-upload count, and last-sync time.
- **SYNC-01** — PowerSync local schema mirroring all down-synced tables; local-only tables
  for sales, returns, shifts, receipts, and the outbox.
- **SYNC-02** — Branch-scoped Sync Streams (edition 3) using signed JWT claims
  (`branch_id`, `terminal_id`).
- **SYNC-03** — PowerSync token endpoint: short-lived, device-bound JWT issued only to
  active, enrolled devices.
- **SYNC-04** — Upload endpoint: ordered batches, one atomic server transaction per client
  transaction, idempotent by terminal + client transaction ID, per-item results on HTTP 200.
- **SYNC-05** — Conflict records for stock oversell, over-limit credit, loyalty negative
  balance, price mismatch, and stale credentials; manager resolution UI is Phase 8.
- **SYNC-06** — Reconciliation: stock projection vs ledger, credit/loyalty projections vs
  ledgers; discrepancy report.
- **SYNC-07** — Durable outbox: writes and outbox entries commit in one local transaction;
  survives restart and crash; exponential backoff with a dead-letter state.
- **SYNC-08** — Sync status and errors surfaced in the POS UI and in the admin console.

---

## POS Payments, Returns & Shifts (POS / PAY) — Phase 7

- **POS-10** — Returns/refunds: look up the original sale, select lines/quantities, reason,
  manager approval, restock; cash refunds work offline, electronic refunds require internet.
- **POS-11** — Electronic tenders online: Paystack MoMo, card, and bank transfer; split
  tender including cash + electronic; change computed correctly.
- **POS-12** — Credit repayment at the POS (cash offline, MoMo/card online) with receipt.
- **POS-13** — X-report and Z-report, drawer reconciliation, and receipt reprint.
- **PAY-01** — Paystack charge: MoMo providers `mtn`/`atl`/`vod`, card, and bank transfer;
  amounts in GHS pesewas.
- **PAY-02** — Webhook and verify are the source of truth: HMAC signature verification,
  idempotent event storage, verify fallback, never trust client success.
- **PAY-03** — Refunds and partial refunds via Paystack with status tracking.
- **PAY-07** — Mock/test payment provider for development without credentials; the same
  interfaces switch to live keys.

---

## Admin Operations, Reports & E-VAT (ADM / RPT / PAY / EVAT) — Phase 8

- **ADM-02** — Executive dashboard: sales, transactions, average basket, tax collected,
  low stock, credit outstanding, supplier payables, loyalty issued/redeemed, sync health,
  and recent activity.
- **ADM-07** — POS oversight: sales/returns lists and detail, shifts and variance,
  terminals/devices/enrollment, sync conflicts queue with resolution, receipt reprint.
- **ADM-08** — Users, roles, settings, feature flags, and audit log viewer.
- **RPT-01** — Sales report by date/branch/terminal/cashier; totals and tax split.
- **RPT-02** — Tax report (VAT/NHIL/GETFund) by period and branch.
- **RPT-03** — Product performance report: quantity, revenue, cost, margin.
- **RPT-04** — Stock report: on-hand, value at average cost, movements, transfers, counts.
- **RPT-05** — Credit aging, supplier payables aging, and loyalty liability.
- **RPT-06** — CSV export and printable statements/reports.
- **PAY-04** — Supplier transfers via Paystack to MoMo/bank recipients with status webhooks.
- **PAY-05** — Manual supplier payment fallback with allocation.
- **PAY-06** — Payment reconciliation report: internal payments vs Paystack transactions.
- **EVAT-01** — Receipt contract: seller TIN/VAT number, serial, terminal, date, tax
  breakdown, QR payload, and signature fields.
- **EVAT-02** — `EInvoicingProvider` adapter (mock + GRA) with offline generation and
  submission within 24 hours.
- **EVAT-03** — Submission retry state machine; failed submissions visible in the console.

---

## Production Hardening & Launch (OPS) — Phase 9

- **OPS-01** — VPS Docker Compose staging and production stacks with Caddy TLS, separate
  databases/volumes/env files, and resource limits.
- **OPS-02** — Postgres TLS and PowerSync Cloud connectivity for staging/production:
  static IP allowlist, dedicated replication role, publication, `wal_level=logical`
  (development/CI use the self-hosted Docker service).
- **OPS-03** — Encrypted `pg_dump` backups to Cloudflare R2 with retention, a restore
  script, and a documented restore drill.
- **OPS-04** — Monitoring: health endpoints, external uptime monitor, error tracking,
  log rotation, and basic alerting.
- **OPS-05** — CI/CD: staging auto-deploy, production approval gate, migrations before
  deploy, health-checked rollout, and rollback.
- **OPS-06** — Security hardening: rate limits, CSP/secure headers, dependency and secret
  scanning, secrets rotation, and an OWASP ASVS L2 review.
- **OPS-07** — Offline drill suite (network loss, restart, duplicate upload, clock skew,
  last-unit race) plus E2E and load tests.
- **OPS-08** — Windows installer signing/auto-update, runbooks, UAT, and a go-live
  checklist.

---

## Coverage Check

| Phase | Requirements |
|---|---|
| 1 | FOUND-01…14, ADM-01, ADM-09 |
| 2 | CAT-01…08, ADM-03 |
| 3 | INV-01…09, ADM-04 |
| 4 | CUS-01…06, LOY-01…06, ADM-05 |
| 5 | SUP-01…05, ADM-06 |
| 6 | POS-01…09, POS-14, SYNC-01…08 |
| 7 | POS-10…13, PAY-01…03, PAY-07 |
| 8 | ADM-02, ADM-07, ADM-08, RPT-01…06, PAY-04…06, EVAT-01…03 |
| 9 | OPS-01…08 |

Every requirement maps to exactly one phase.
