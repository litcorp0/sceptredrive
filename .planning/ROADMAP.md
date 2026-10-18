# ROADMAP — GikAutos v1

## Overview

GikAutos v1 is delivered as nine capability phases, each a coherent, verifiable slice.
Phases are ordered by dependency: the foundation and catalog must exist before
inventory; inventory before POS; POS before payments and returns; reporting and
hardening come last. Only the POS is offline-first; the admin console and API are online.

**Depth:** Comprehensive (9 phases)
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

**Key risk:** Electron Forge's Vite plugin is experimental. Pin versions; the first plan in
this phase is a PowerSync Web SDK + WASM worker spike. Fallback: Forge Webpack renderer, or
the PowerSync Node SDK in the main process with IPC.

---

## Phase 7 — POS Payments, Returns & Shifts

**Goal:** Online electronic payments (MoMo, card, bank), split tender, returns and refunds,
credit repayments, and full shift reporting work end to end.

**Dependencies:** Phase 6
**Requirements:** POS-10…13, PAY-01…03, PAY-07

**Success Criteria**
1. A MoMo charge returns `pay_offline`, the customer approves, the webhook settles the
   tender, and the receipt shows paid; the verify fallback works.
2. A card payment completes in the Paystack checkout and is verified server-side.
3. A split cash + electronic tender computes the remaining balance and change correctly.
4. A cash refund completes offline after manager approval; a MoMo refund completes online
   through Paystack.
5. Shift close produces a Z-report whose totals and variance match the local transactions.
6. A credit repayment at the POS reduces the branch balance and prints a receipt.

**Planned scope:** Paystack charge/verify/webhook/refund; mock provider; split tender; POS
returns flow; repayment flow; X/Z reports; drawer reconciliation; receipt reprint.

---

## Phase 8 — Admin Operations, Reports & E-VAT

**Goal:** The admin console gives a complete operational picture; managers resolve sync
conflicts; reports reconcile; supplier transfers run through Paystack; E-VAT receipts are
queued and submitted through an adapter.

**Dependencies:** Phases 5–7
**Requirements:** ADM-02, ADM-07, ADM-08, RPT-01…06, PAY-04…06, EVAT-01…03

**Success Criteria**
1. The dashboard shows real KPIs per branch and period (no hardcoded values); a manager
   sees only their branch.
2. Sales, shifts, terminals, and sync conflicts are inspectable; a conflict can be resolved
   with an audit record.
3. Reports (sales, tax, product performance, stock, credit aging, payables, loyalty) match
   the ledgers and export to CSV.
4. A supplier payment via Paystack (test mode) creates a recipient and transfer, and the
   webhook updates the payment status; manual payments still work.
5. E-VAT receipts are queued offline, submitted by the mock provider, and retried on failure;
   failures are visible.
6. Users, roles, settings, feature flags, and the audit log are manageable.

**Planned scope:** dashboard and rollups; POS oversight screens; conflict resolution;
report queries and CSV/PDF; supplier Paystack transfers + reconciliation; E-VAT adapter and
receipt contract; audit viewer; settings screens.

---

## Phase 9 — Production Hardening & Launch

**Goal:** Staging and production run on the VPS with TLS, backups, monitoring, security
controls, offline drills, a signed Windows installer, and a signed-off UAT.

**Dependencies:** Phases 1–8
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
            │              └─ Phase 7 POS Payments/Returns
            │                   └─ Phase 8 Admin/Reports/E-VAT
            │                        └─ Phase 9 Hardening/Launch
            └──────────────────────────────────────┘
```

## Milestone Definition

**v1 is done when:** a cashier can run a full shift offline (cash and credit), a manager
can run their branch and resolve conflicts, the admin can see the whole business, all
ledgers reconcile, suppliers can be paid, and the system runs in production on the VPS
with tested backups and monitoring.
