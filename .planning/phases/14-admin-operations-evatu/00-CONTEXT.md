---
phase: 14-admin-operations-evatu
name: Admin Operations & E-VAT
depends_on: [05-suppliers-payables, 09-analytics-dashboard, 12-branch-ops-approvals, 13-pos-payments-returns]
requirements: [ADM-07, ADM-08, RPT-04, RPT-05, RPT-06, PAY-04, PAY-05, PAY-06, EVAT-01, EVAT-02, EVAT-03]
status: context-locked
created: 2026-10-24
---

# Phase 14 — Admin Operations & E-VAT — Locked Context

**Goal:** The console can see and correct what the terminals did, pay suppliers through
Paystack, produce the remaining reports, and queue E-VAT receipts through an adapter that a
real provider can be dropped into.

## Problem

This phase used to own the executive dashboard and the sales, tax, and product reports. Those
moved to **Phase 9**. What remains is the operational underside: POS oversight, sync-conflict
resolution, the stock/aging/liability reports, supplier transfers, E-VAT, and the
users/settings/audit surfaces. Until this is re-scoped, the phase overlaps Phase 9 and would
be planned twice.

## Locked Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Scope | POS oversight (sales, refunds, shifts, terminals, devices), sync-conflict resolution, stock/aging/liability reports with CSV and print, supplier Paystack transfers, E-VAT adapter with a mock provider, users/settings/audit management | Operator decision 2026-10-24. The executive dashboard, sales report, tax report, and product performance are **delivered in Phase 9 and not rebuilt here** |
| D2 | Oversight content | Sales and refund lists with line detail and receipt reprint, shift list with variance and the Phase 12 review state, terminal and device inventory with enrollment and revocation, and the **sync-conflict queue with resolution**. Read-only except conflict resolution and device revocation | Operator decision. This is where the Phase 12 shift review and the Phase 6 conflict records become usable |
| D3 | Conflict resolution | Resolve or dismiss with a reason code and a note; the decision is audited with the actor, the conflict snapshot before and after, and the linked sale/shift. Resolution never rewrites a sale, a movement, or a ledger row | The conflict is the record; correcting the underlying fact is a new document |
| D4 | Remaining reports | Stock report (on-hand, value at average cost, movement history, transfers, counts), credit aging, payables aging, and loyalty liability — each reconciled to its ledger, filterable by branch and period, exportable to CSV and printable. CSV escaping follows the Phase 9 rule | RPT-04…06; the sales/tax/product reports already exist |
| D5 | Supplier transfers | Paystack **transfer recipients** per supplier payment detail, transfer initiation, webhook-driven status, and a reconciliation view of internal payments versus Paystack transactions. Manual payment stays the fallback and never depends on Paystack being reachable. Test mode until go-live | PAY-04…06. The `supplier_payment_detail.paystackRecipientCode` column was reserved in Phase 5 |
| D6 | E-VAT | Ship the `EInvoicingProvider` interface plus a **mock provider only**. Receipts carry the reserved QR, serial, and signature fields; the mock accepts and records them. Submission is queued, retried with backoff, and failures are visible. The GRA adapter is written at onboarding, not now | Operator decision 2026-10-24. Building an unverified GRA integration would be guesswork against a spec we cannot test |
| D7 | Users and roles | Three fixed roles remain (`ADMIN`, `MANAGER`, `CASHIER`); this phase manages **assignment**, activation, and password/PIN resets, not custom role creation. Feature flags are a small typed registry with an admin toggle, not a general-purpose flag service | ADM-08 read literally would imply custom roles, which the permission model does not support. Stating the boundary prevents a phase that cannot finish |
| D8 | Settings surface | Every typed setting is editable per its scope rules (global for admin, branch for branch-scoped keys), with the effective value and its source (`branch`, `global`, `default`) visible | The API already resolves this; the console should show it rather than guess |
| D9 | Audit viewer | Filter by actor, action, entity, branch, and date; open an entry's before/after payload; export CSV. PII stays out of payloads as established in Phase 6 | FOUND-10; OWASP A09 |
| D10 | Security | Every endpoint permission-checked server-side and branch-scoped; Paystack webhook HMAC-verified and idempotent; no secrets, tokens, or customer PII in logs or exports | OWASP A01/A02/A09 |
| D11 | Verification | API walkthrough per surface; conflict resolution leaves the sale untouched and the audit complete; report totals reconcile to the ledgers; Paystack transfer in test mode with webhook; mock E-VAT submission, retry, and failure visibility; permission matrix for admin vs manager | Goal-backward |

## Invariants

- Oversight reads, it does not rewrite. Corrections are new documents.
- A conflict resolution is an audit record, never an edit to the sale or ledger.
- Manual supplier payment keeps working with Paystack unavailable.
- Reports reconcile to the ledgers or they are wrong.
- No secret, token, or customer PII in an export or a log.

## Open Items

- The GRA adapter, seller TIN/VAT registration, and E-VAT certification are onboarding tasks
  tracked outside the code plan.
- Custom roles, if ever wanted, are a separate phase; the permission model is a fixed matrix.
- Physical receipt printing of the E-VAT QR waits for the real provider.

## Planned Plans

1. Schema and permissions: conflict resolution, audit filters, feature-flag registry.
2. POS oversight APIs: sales, refunds, shifts, terminals, devices.
3. Conflict resolution and audit.
4. Stock, aging, and liability reports with CSV and print.
5. Supplier Paystack transfers, webhook, reconciliation, manual fallback.
6. E-VAT provider interface, mock, queue, retries, failure surface.
7. Console UI: oversight screens, reports, supplier payments, E-VAT, users, settings, audit.
8. Verification, evidence, state update.
