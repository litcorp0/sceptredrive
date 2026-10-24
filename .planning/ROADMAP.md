# ROADMAP — Sceptre Drive v1

> **Renamed 2026-10-24.** The product is **Sceptre Drive** (formerly GikAutos). The code,
> workspace package scope, app protocol, Docker names, and remaining documents are
> renamed in **Phase 7**. Historic phase records keep the old name until that sweep.

## Overview

Sceptre Drive v1 is delivered as fifteen capability phases, each a coherent, verifiable
slice. Phases are ordered by dependency: the foundation and catalog must exist before
inventory; inventory before POS; then the interface foundation; then the operational control
that lets a manager actually run a branch (procurement, replenishment, approvals); then POS
payments and the remaining operations; hardening last. Only the POS is offline-first; the
admin console and API are online.

Phases **7–10** were inserted on 2026-10-24 (interface foundation, modules, analytics, POS
redesign). Phases **11–12** were added the same day after an operational audit (procurement
and replenishment, branch operations and approvals). The former Phases 7, 8, and 9 became
**13, 14, and 15**, with the original payment and admin-operations phases moving to 13/14.

**Depth:** Comprehensive (15 phases)
**Coverage:** 100% of v1 requirements mapped to exactly one phase (`REQUIREMENTS.md`).

---

## Phase 1 — Foundation & Platform

**Goal:** A clean monorepo runs end to end. Admin and manager sign in; the organisation
(branches, warehouses, terminals, staff) exists; permissions and audit are enforced;
CI is green.

**Status:** ✅ Complete (verified 2026-10-18 — see `phases/01-foundation/01-VERIFICATION.md`)
**Dependencies:** none
**Requirements:** FOUND-01…14, ADM-01, ADM-09

**Success Criteria**
1. Admin logs in and creates a retail branch, a warehouse, a terminal, a manager, and a cashier.
2. A manager sees only their own branch; a cashier cannot reach admin functions; every
   endpoint is permission-checked server-side.
3. A terminal enrollment code can be generated, used, listed, and revoked.
4. Every mutating action appears in the audit log with actor, entity, branch, and timestamp.
5. `bun lint`, `bun check-types`, `bun test`, and `bun build` pass locally and in CI.

**Planned scope:** workspace + tooling; env validation; Docker Compose Postgres; Drizzle
setup and first migrations; Hono API skeleton (health, logging, errors, headers, CORS);
Better Auth with TOTP; roles and branch scoping; branches/warehouses/terminals/devices;
staff management; audit log; settings; admin shell and auth pages; email adapter; CI.

---

## Phase 2 — Catalog & Pricing

**Goal:** A fitment-free product catalog with SKUs, barcodes, categories, brands, units,
prices, and correct Ghana tax is fully managed in the admin console.

**Status:** ✅ Complete (verified 2026-10-18 — see `phases/02-catalog-pricing/01-VERIFICATION.md`)
**Dependencies:** Phase 1
**Requirements:** CAT-01…08, ADM-03

**Success Criteria**
1. Admin creates a category, brand, unit, product, barcode, and price.
2. Duplicate barcodes and duplicate SKUs are rejected with clear errors.
3. A manager can set a price override for their branch only; the admin can set any.
4. Tax computed for a GHS 100.00 inclusive price yields the correct VAT/NHIL/GETFund split.
5. Product search finds items by name, SKU, and barcode with debounced input.

**Planned scope:** catalog schema and migrations; catalog API with validation; tax domain
functions and tests; admin catalog list/create/edit screens; archive flows.

---

## Phase 3 — Inventory & Transfers

**Goal:** Stock is a single, auditable truth per branch. Goods are received, adjusted,
transferred, and counted; warehouses and retail branches interoperate.

**Status:** ✅ Complete (verified 2026-10-18 — see `phases/03-inventory-transfers/01-VERIFICATION.md`)
**Dependencies:** Phase 2
**Requirements:** INV-01…09, ADM-04

**Success Criteria**
1. On-hand equals the sum of movements for every product/branch, and no update or delete
   path exists for movements.
2. Receiving stock with a supplier invoice number increases stock, records cost, and
   creates a payable.
3. Adjustments require a reason and appear in the audit log.
4. A transfer moves through dispatch and receive; partial receive records a discrepancy.
5. A stock count posts its variance as an adjustment.
6. A warehouse branch cannot host POS sales; low-stock lists are correct.

**Planned scope:** stock ledger + projection; receive/adjust; transfers; counts; low stock;
inventory API and console; stock history.

---

## Phase 4 — Customers, Credit & Loyalty

**Goal:** One customer identity across the business, branch-local credit with limits and
ledgers, and a global loyalty program with earning, redemption, and expiry.

**Status:** ✅ Complete (verified 2026-10-19 — see `phases/04-customers-credit/01-VERIFICATION.md`)
**Dependencies:** Phases 1–3
**Requirements:** CUS-01…06, LOY-01…06, ADM-05

**Success Criteria**
1. A customer created at branch A is found by phone at branch B, but only branch A owns
   their credit limit and balance.
2. A credit sale posts to the branch ledger; an over-limit sale is blocked online and can
   be overridden with a reason by a manager.
3. A repayment reduces the balance; the statement and aging report reconcile to the ledger.
4. Loyalty earn/redeem/adjust update the ledger and balance; expired points are removed by
   the expiry job.
5. Managers see only their branch's credit; the admin sees all branches.

**Planned scope:** customer + branch profile schema; credit ledger, repayments,
statements, aging; loyalty account, ledger, lots, settings, expiry job; admin console
screens; permission checks.

---

## Phase 5 — Suppliers & Payables

**Goal:** Suppliers, the products they supply, invoices on credit, payments, and balances
are tracked accurately per branch and in aggregate.

**Status:** ✅ Complete (verified 2026-10-22 — see `phases/05-suppliers-payables/01-VERIFICATION.md`)
**Dependencies:** Phases 3–4
**Requirements:** SUP-01…05, ADM-06

**Success Criteria**
1. Recording a supplier invoice increases the amount owed and links to its stock receipt.
2. A partial payment is allocated to an invoice; the remaining balance is correct.
3. Payment history and payables aging per supplier/branch reconcile to invoices and payments.
4. Supplied products list the supplier SKU and last cost.

**Planned scope:** supplier master and products; invoices and lines; manual payments and
allocations; balances/aging; admin console screens.

---

## Phase 6 — POS Offline Core

**Goal:** A cashier enrolls a Windows terminal, logs in with a PIN, opens a shift, sells
for cash or credit with loyalty, prints a receipt, and everything reconciles after
reconnecting — without blocking a sale.

**Dependencies:** Phases 1–5
**Requirements:** POS-01…09, POS-14, SYNC-01…08
**Status:** ✅ Complete and verified 2026-10-23 (9/9 plans). A fresh database + real
Electron build reproduce the whole offline POS story: enrollment → PINs → shift → offline
cash/credit sale with loyalty and a manager-approved discount → ESC/POS receipt + drawer →
quit → offline relaunch → exact-once upload → HIGH conflicts → revocation → reconciliation.
Evidence: `.planning/phases/06-pos-offline-core/01-VERIFICATION.md` and
`phases/06-pos-offline-core/evidence/` (walkthrough 162/162, race 18/18, duplicate 24/24,
Electron E2E 51/51, shell 38/38, print 21/21; API 354, shared 73, desktop 339).
Development/CI use the self-hosted PowerSync Docker service; staging/production use
PowerSync Cloud (Phase 9 setup gate).

**Success Criteria**
1. With the network unplugged, a cashier completes cash sales, prints receipts, and stock
   deducts locally.
2. On reconnect, queued sales upload exactly once; on-hand equals the ledger; no duplicate sale.
3. Two terminals sell the last unit offline; both sales apply and a reconciliation conflict
   is recorded for manager review.
4. A credit sale within the cached limit completes offline; over-limit requires a manager
   PIN; the server revalidates and flags conflicts.
5. Loyalty earn/redeem works offline within the cached balance; double-spend is flagged.
6. PIN login works offline after enrollment; revoked or disabled staff are rejected on sync.
7. Killing and restarting the app preserves pending sales and the outbox.

**Planned scope:** Electron Forge shell + security; PowerSync local schema + connector;
device enrollment and tokens; offline PIN; shifts; cart/scan/search; cash and credit sales;
loyalty; ESC/POS receipts and drawer; outbox + upload endpoint; sync streams; conflicts;
sync status UI; Windows packaging groundwork.

**Key risk (retired for the Web SDK):** Plan 02 proved the PowerSync Web SDK (WASM workers,
encrypted SQLite) inside the sandboxed Electron 45 renderer served from `app://gikautos`,
including restart persistence in a packaged build. Forge 8 + Vite 8 packaging of the Bun
workspace also works (`bun run package:pos`). Remaining packaging risk: the native printer
module and the Squirrel installer on Windows (Plans 07/09). The Node-SDK fallback is not
needed.

---

## Phase 7 — Identity, Design System & Brand Foundation

**Goal:** The product is called Sceptre Drive everywhere it is visible or load-bearing, and
both clients draw from one design-token source, one typography set, one primitive library,
and one date formatter — so the admin console and the POS cannot drift apart again.

**Dependencies:** Phase 6
**Requirements:** UIX-01…05

**Success Criteria**
1. `grep -rIl gikautos` over the repository returns only the documented allowlist (the
   placeholder domain constant, applied migration history, and historical phase records).
2. Admin and desktop both import the same `@sceptre/brand` token file; changing one hex
   value changes both apps and requires no other edit.
3. The palette is AA-compliant: charcoal on orange for primary actions, never white on
   orange; every text/background pair reaches 4.5:1 (3:1 for large text).
4. Every date and time in both clients is rendered through `date-fns` helpers from
   `@sceptre/shared`; no bare `toLocaleDateString`/`toLocaleString` remains.
5. Both apps build and the full suite passes after the rename: API 354, shared 73, desktop
   339, plus the Electron E2E and packaged shell/print smoke tests.

**Planned scope:** workspace and package-scope rename; desktop protocol host, product name,
CSP constants, window titles; Docker/compose/database names; `packages/brand` (tokens,
fonts, chart ramp); self-hosted Space Grotesk / Inter / JetBrains Mono; shadcn `chart`,
`sidebar`, and supporting primitives in both apps; `date-fns@4` and shared formatting
helpers; the first pass of the redesigned shell chrome.

---

## Phase 8 — Admin Module Architecture & Shell

**Goal:** Every admin screen is assembled inside a domain module and the route file only
routes, so a feature can be understood, tested, and changed without reading the router.

**Dependencies:** Phases 1–7
**Requirements:** UIX-06, UIX-07

**Success Criteria**
1. `admin/src/modules/` contains every domain, and every module has `api/`, `components/`,
   `hooks/`, `pages/`, `types/`, `ui/`, and `utils/`.
2. Every file under `admin/src/routes/` is a thin route: `createFileRoute` plus a single
   page import, with no page markup.
3. A module cannot reach into another module's internals — cross-module use goes through
   the target module's `index.ts`, and Biome's `noRestrictedImports` fails the build
   otherwise.
4. The shell is role-aware: navigation is permission-filtered, the branch switcher is
   locked for managers, the mobile drawer is keyboard-operable, and a skip link reaches
   the main region first.
5. No behaviour changes: the existing screens work exactly as before, proven by the suite
   and a manual pass over each section.

**Planned scope:** `modules/` scaffolding and the import-boundary rule; migration of audit,
settings, staff, branches, terminals, catalog, inventory, customers, credit, loyalty,
suppliers, payables, auth, and dashboard one module per commit; rebuilt app shell, sidebar,
topbar, page header, and empty/loading/error states on the new tokens.

---

## Phase 9 — Analytics, Dashboard & Reporting Read Models

**Goal:** The console shows the truth about the business — real, reconciled, branch-correct
numbers with charts that answer a manager's question and an owner's question differently.

**Dependencies:** Phases 6–8
**Requirements:** ADM-02, RPT-01…03, ANL-01…03

**Success Criteria**
1. Every figure on the dashboard and the analytics page comes from a server aggregate that
   reconciles to the ledgers; nothing is computed from a paged list endpoint.
2. A manager sees only their own branch and cannot obtain another branch's numbers by
   changing a query parameter; an admin sees the organisation with branch comparison.
3. Period, branch, and granularity live in the URL, so any view can be linked and reloaded.
4. Charts state their own meaning without a hover: labelled axes, a legend, a summary
   sentence, and a data-table alternative for every chart.
5. Period-over-period deltas, tender mix, top products, and tax split are all derived from
   integer minor units; no floating-point arithmetic touches money.
6. A demo seed produces a realistic month of sales so the dashboard is reviewable locally.

**Planned scope:** `api/src/modules/analytics/` in the seven-file layout; `analytics.read`
permission; Zod-validated period/branch/granularity; branch scope enforced server-side;
overview, sales, product, inventory, credit, loyalty, payables, and tax read models;
reconciliation tests; CSV export with formula-injection escaping; `seed:demo-sales`; the
`dashboard` and `analytics` modules with the Till Line, KPI tiles, and Recharts charts.

---

## Phase 10 — Desktop POS Modules, Chrome & Shift Home

**Goal:** The terminal wears the same brand as the console, opens on a shift dashboard that
answers "how is today going?", and still sells with the network unplugged.

**Dependencies:** Phases 6–9
**Requirements:** UIX-08, UIX-09

**Success Criteria**
1. `desktop/src/renderer/modules/` holds every POS domain with the same seven folders, and
   `routes/` files resolve a hash route to a module page.
2. A cashier signs in, lands on the shift home, sees today's take, cash in drawer, credit
   given, items sold, the day's hourly shape, and top sellers — then starts selling in one
   action.
3. The home screen and every redesigned screen work with the network unplugged; charts read
   the local PowerSync database.
4. The redesign changes nothing about the money rules: the full desktop suite (339), the
   Electron E2E (51), the offline walkthrough, packaged shell (38), and packaged print (21)
   all still pass.
5. Offline is presented as a normal state with an honest sync badge, never as an error, and
   no counter action is hover-only.

**Planned scope:** `modules/` migration for home, sell, cart, catalog, customers, credit,
loyalty, tender, shift, sales, receipt, sync, settings, and auth; `components/ui` shadcn
primitives; redesigned header, product grid, cart, tender, shift, sales, receipt, and sync
screens; the new `#home` shift dashboard with Recharts over local SQLite; keyboard and
touch target audit; offline-state copy pass.

---

## Phase 11 — Procurement, Replenishment & Supplier Returns

**Goal:** A manager can decide what to order from the numbers on screen, raise a purchase
order, get it approved when it matters, receive the goods against what was ordered, send
back what is wrong, and see which suppliers actually deliver.

**Dependencies:** Phases 3, 5, 10
**Requirements:** PROC-01…10, MGR-01…05

**Success Criteria**
1. A manager raises a purchase order with supplier, lines, quantities, cost prices, and an
   expected date. Below the branch threshold it is approved automatically; at or above it,
   it waits for the admin and cannot be sent.
2. Receiving works in full, partial, short, and over deliveries. Each line shows ordered,
   previously received, received now, and outstanding. A short delivery leaves the order
   open for a second receipt; an over-delivery needs a reason and is recorded as a
   discrepancy.
3. Receiving posts stock movements and average cost through the existing ledger path; no
   new stock write path is introduced and the ledger stays append-only.
4. A supplier invoice can be matched to a purchase order. A price or quantity difference is
   flagged with both values, never silently accepted, and never blocks the payable.
5. A purchase return against a received order creates a credit note that reduces the
   supplier balance and posts a negative stock movement. Nothing is edited or deleted.
6. Every product carries a min and a max per branch. The replenishment screen suggests a
   quantity from recent sales velocity and the preferred supplier's lead time, groups
   suggestions by supplier, and raises one purchase order from the selection.
7. Supplier performance is measurable: on-time delivery, fill rate, actual versus promised
   lead time, and last-cost drift.
8. Every state change is audited, numbers reconcile to the ledgers, and the POS is untouched.
9. A manager submits a new product with a proposed price; the product is created only when an
   admin approves it, and the catalogue's cost figure is derived from receipts rather than
   typed by hand.
10. The first receipt of a part from a supplier creates the supplier-product link with its
    last cost, so lead time and cost history begin with the first delivery.

**Planned scope:** purchase order and line schema; approvals entity and threshold
resolution; goods receipt linked to order lines; supplier-product link auto-creation;
invoice matching and variance flags; purchase returns and supplier credits; min/max per
branch; velocity and lead-time suggestions; supplier performance read model; permissions for
manager supplier creation and product submission; derived catalogue cost; console screens for
ordering, receiving, returns, and replenishment.

---

## Phase 12 — Branch Operations & Approval Workflow

**Goal:** The branch manager can request what the branch needs and the admin can decide,
with one queue, one audit trail, and no path where stock, price, credit, or cash changes
without a decision that names the person who made it.

**Dependencies:** Phases 11, 10
**Requirements:** APR-01…06, BRN-01…05, CC-01…05

**Success Criteria**
1. A manager requests a transfer; the source branch manager approves branch-to-branch and
   the admin approves warehouse-to-branch. A rejected request moves no stock.
2. One approval inbox lists every pending item with type, value, branch, requester, and age;
   each opens a detail view and can be approved or rejected with a reason. Both decisions
   are audited with before and after values.
3. Nobody approves their own request. A manager who raises a request from their own branch
   has it decided by the admin.
4. A stock write-off needs a reason code and an approval; on approval a negative movement
   posts, on rejection nothing changes.
5. A manager may move a price within ±10% of the current effective branch price; beyond the
   band a request is raised showing the old and new price, and approval applies the change
   exactly once.
6. A manager may propose a credit limit change; the effective limit changes only after the
   admin approves it.
7. A shift closed with a variance beyond tolerance is marked for review; a manager or admin
   records an outcome, and the shift numbers stay immutable.
8. The manager's console shows their branch queues at a glance: pending approvals, transfer
   requests, write-offs, shift variances, low stock, and customers over their credit limit.
9. Counts can be scheduled by category, brand, or value class; the system generates count
   tasks with a due date and an assignee, raises a spot count when a variance or repeated
   oversell is detected, and reports inventory accuracy per branch.

**Planned scope:** transfer request lifecycle; approvals extension and unified inbox; stock
write-off workflow; price band resolution and price change requests; credit limit change
requests; shift variance review; cycle count scheduling, ABC classification, trigger counts,
and accuracy reporting; manager operations dashboard; nav badges; permissions for request and
decide; audit on every decision.

---

## Phase 13 — POS Payments, Returns & Shifts

**Goal:** Online electronic payments (MoMo, card, bank), split tender, returns and refunds,
credit repayments, and full shift reporting work end to end.

**Dependencies:** Phases 6, 10, 12
**Requirements:** POS-10…13, PAY-01…03, PAY-07

**Success Criteria**
1. A MoMo charge returns `pay_offline`, the customer approves, the webhook settles the
   tender, and the receipt shows paid; the verify fallback works.
2. A card payment completes in the Paystack checkout and is verified server-side.
3. A split cash + electronic tender computes the remaining balance and change correctly.
4. A cash refund completes offline on a manager PIN; a refund at or above the configured cap
   raises a retrospective approval, and a MoMo refund completes online through Paystack.
5. Shift close produces a Z-report whose totals and variance match the local transactions.
6. A credit repayment at the POS reduces the branch balance and prints a receipt.
7. A cashier holds three labelled carts, serves a fourth customer, recalls any held cart after
   restarting the application, and sees a notice where a held line's price changed.
8. A cart is voided with a reason code; the void is recorded against the shift and cashier and
   reaches the server without blocking selling.
9. One sale takes GHS 100 cash, GHS 50 MoMo, and GHS 200 on credit against the remaining
   limit; change comes only from the cash tender and the credit ledger receives exactly GHS 200.

**Planned scope:** Paystack charge/verify/webhook/refund; mock provider; split tender across
cash, electronic, and credit; POS returns flow; repayment flow; X/Z reports; drawer
reconciliation; receipt reprint; held carts with labels and recall across restarts; cart void
with reason codes and outbox upload.

---

## Phase 14 — Admin Operations & E-VAT

**Goal:** The admin console gives a complete operational picture; managers resolve sync
conflicts; supplier transfers run through Paystack; E-VAT receipts are queued and submitted
through an adapter.

**Dependencies:** Phases 5, 13
**Requirements:** ADM-07, ADM-08, RPT-04…06, PAY-04…06, EVAT-01…03

**Success Criteria**
1. Sales, refunds, shifts, terminals, devices, and sync conflicts are inspectable; a conflict
   can be resolved with an audit record, and a receipt can be reprinted from the server.
2. Reports (stock, credit aging, payables aging, loyalty liability) match the ledgers and
   export to CSV or print.
3. A supplier payment via Paystack (test mode) creates a recipient and transfer, and the
   webhook updates the payment status; manual payments still work.
4. E-VAT receipts are queued offline, submitted by the mock provider, and retried on failure;
   failures are visible.
5. Users, roles, settings, feature flags, and the audit log are manageable.

**Planned scope:** POS oversight screens; conflict resolution; stock/aging/liability report
queries and CSV/PDF; supplier Paystack transfers + reconciliation; E-VAT adapter and
receipt contract; audit viewer; settings screens. The executive dashboard and sales/tax/
product reports were delivered in Phase 9.

---

## Phase 15 — Production Hardening & Launch

**Goal:** Staging and production run on the VPS with TLS, backups, monitoring, security
controls, offline drills, a signed Windows installer, and a signed-off UAT.

**Dependencies:** Phases 1–14
**Requirements:** OPS-01…08

**Success Criteria**
1. Pushing to `staging` deploys automatically; health checks pass; migrations apply cleanly.
2. Production deploy requires approval, backs up first, and can roll back to the previous tag.
3. A restore drill recreates the database from an encrypted R2 backup with documented RPO/RTO.
4. The offline drill suite passes (network loss, restart, duplicate upload, clock skew,
   last-unit race, token expiry).
5. Security review passes: OWASP ASVS L2 checklist, no secrets in the repo, dependency and
   secret scans clean or explicitly accepted.
6. The Windows installer enrolls a terminal, sells offline, and auto-updates from a release.
7. UAT is signed off against the five-branch/20-terminal target, with runbooks and a go-live
   checklist.

**Planned scope:** Docker Compose staging/prod; Caddy; Postgres TLS + PowerSync connectivity;
backups + restore script; monitoring/alerting; CI/CD deploy pipelines; security hardening;
offline/E2E/load tests; installer signing and auto-update; runbooks and UAT.

---

## Dependency Graph

```text
Phase 1 Foundation
  └─ Phase 2 Catalog
       └─ Phase 3 Inventory
            ├─ Phase 4 Customers/Credit/Loyalty
            │    └─ Phase 5 Suppliers/Payables
            │         └─ Phase 6 POS Offline Core
            │              ├─ Phase 7 Identity/Design System
            │              │    └─ Phase 8 Admin Modules & Shell
            │              │         └─ Phase 9 Analytics & Dashboard
            │              │              └─ Phase 10 Desktop Modules & Shift Home
            │              │                   ├─ Phase 11 Procurement & Replenishment
            │              │                   │    └─ Phase 12 Branch Ops & Approvals
            │              │                   │         └─ Phase 13 POS Payments/Returns
            │              │                   │              └─ Phase 14 Admin Ops & E-VAT
            │              │                   │                   └─ Phase 15 Hardening/Launch
            └──────────────────────────────────────┘
```

Phases 11–12 depend on Phase 10 only because they are built in the module layout and the
design system; their business dependencies are Phases 3 and 5. Phase 13 builds on the module
layout from Phase 10 and uses the Phase 12 approval entity **only** for refunds at or above
the cap when the terminal is online; a cash refund authorised offline completes on the till
PIN and raises that approval retrospectively on sync.

## Milestone Definition

**v1 is done when:** a cashier can run a full shift offline (cash and credit), a manager
can run their branch and resolve conflicts, order stock, request a transfer, and get a
decision without leaving the console, the admin can see the whole business in a dashboard and
analytics view they trust, all ledgers reconcile, suppliers can be paid, and the system runs
in production on the VPS with tested backups and monitoring.
