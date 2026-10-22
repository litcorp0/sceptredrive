---
phase: 05-suppliers-payables
plan: 07
title: Phase 5 verification — Suppliers & Payables
status: verified
verified: 2026-10-22
verifier: agent (HTTP + SQL walkthrough, Playwright console walkthrough; evidence under evidence/)
---

# Phase 5 — Suppliers & Payables — Verification

**Goal proven:** suppliers, the products they supply, invoices on credit, payments, and
balances are tracked accurately per branch and in aggregate — with every document
reconcilable to its receipt, its allocations, and the supplier's owed balance.

**Environment (adapted to the operator's local PostgreSQL):** the fresh-database cycle
ran on the **local PostgreSQL 18.6 instance at `127.0.0.1:5432`** (systemd
`postgresql.service`), database `gikautos_test` owned by `gikautos`. The `gikautos` role
lacks `CREATEDB`, so the existing owned test database was reset schema-first
(`DROP SCHEMA drizzle/public CASCADE; CREATE SCHEMA public`) instead of dropping the
database. No Docker services were used for verification. Note: the local `gikautos`
database is the **discarded prototype schema** (PascalCase tables such as `Supplier`,
`SupplierInvoice`), not the v1 schema; it was not used. Migrations, seeds, the API
(`:4000`) and the console (`:3000`) ran against `gikautos_test`. The admin TOTP secret
was re-enrolled with `/tmp/opencode/bootstrap-admin-totp.mjs` after each reseed
(`/tmp/opencode/admin-totp.json`).

**Fresh-database cycle (Plan 07 Task 1)**

- Migrations: 7 applied (`0000`…`0006`); `public` holds **40 tables**, including the seven
  Phase 5 tables (`supplier`, `supplier_payment_detail`, `supplier_product`,
  `supplier_invoice`, `supplier_invoice_line`, `supplier_payment`,
  `supplier_payment_allocation`).
- `db:seed` → admin created; `db:seed --demo` → demo data created; **the second
  `db:seed --demo` created nothing** ("demo data already present"). Counts unchanged:
  **2 suppliers, 2 invoices, 2 payments, 1 allocation, 4 product mappings**.
- Sequences persisted after the seed: `supplier.codeSequence = 3`,
  `payable.invoiceSequence = 3`, `payable.paymentSequence = 3`; the walkthrough therefore
  expects the first new documents at `SUP-00003`, `SINV-00003`, `PAY-00003`.
- `bun run lint` — green (363 files).
- `bun run check-types` — green (shared, db, api, admin).
- `bun run test` — **shared 56/56 (6 files) + api 276/276 (22 files)** with
  `TEST_DATABASE_URL=postgresql://gikautos:gikautos@localhost:5432/gikautos_test`.
- `bun run build` — green (admin SSR/client bundle).

**Evidence scripts** (committed for reproduction):

- `evidence/walkthrough-payables.mjs` — HTTP + SQL walkthrough, **102/102** checks on the
  fresh seeded database (raw output: `evidence/walkthrough-payables.log`).
- `evidence/smoke-console-suppliers.mjs` — Playwright console walkthrough, **25/25**
  checks, 18 screenshots (raw output: `evidence/smoke-console-suppliers.log`).

Key screenshots: `02-supplier-create-invalid-phone.png`, `03-supplier-detail.png`,
`04-supplier-payment-details.png`, `05-supplier-products.png`, `06-receive-stock.png`,
`07-receipt-detail.png`, `08-invoice-form-from-receipt.png`, `09-invoice-detail.png`,
`10-payment-dialog.png`, `11-invoice-partial.png`, `12-void-payment-dialog.png`,
`13-invoice-after-void.png`, `14-aging.png`, `15-archive-guard.png`,
`16-supplier-archived.png`, `17-settings-group.png`, `18-manager-settings.png`.

## Success criteria (ROADMAP.md)

### 1. Recording a supplier invoice increases the amount owed and links to its stock receipt — PASS

- The manager recorded receipt `GRN-00003` with `supplierId`; SQL confirmed
  `stock_receipt.supplier_id` equals the supplier and the snapshot `supplier_name` was
  written. The receipt total (3 × GHS 45.00 = **GHS 135.00**) matched the response.
- Recording the invoice with `copyFromReceipt: true` produced **`SINV-00003`** and
  `subtotal + VAT + NHIL + GETFund = total = GHS 135.00` **= the receipt total**.
  SQL proved `supplier_invoice.receipt_id` and `supplier_invoice.supplier_id` in one
  predicate; the invoice detail payload carried `receipt.id`.
- A second invoice on the same receipt → **409** with
  `details.existingInvoiceId = SINV-00003`; a duplicate supplier invoice number →
  **409** with the same id.
- The invoice immediately appeared in balances as money owed
  (`invoiceOutstandingMinor = GHS 135.00` before any payment).

### 2. A partial payment is allocated to an invoice; the remaining balance is correct — PASS

- A GHS 50.00 MoMo payment allocated to `SINV-00003` flipped it to **PARTIAL**,
  `amountPaidMinor = 5000`, `outstandingMinor = 8500`; SQL `amount_paid_minor = 5000`.
- Allocating **GHS 86.00** against the GHS 85.00 outstanding → **409** naming the invoice
  in `details.invoiceId`; allocations to another supplier's invoice and to a VOID invoice
  → **409**.
- A multi-invoice payment (GHS 135.00: 85.00 to `SINV-00003`, 50.00 to the standalone
  invoice) settled the first to **PAID** and left the second **PARTIAL** with the exact
  remaining 200.00; a later payment settled it to **PAID**.
- A payment recorded with no allocation stayed **on account**: the supplier's
  `onAccountMinor` rose by exactly the payment amount.
- Two parallel payments of GHS 80.00 against one GHS 100.00 invoice: exactly one won
  (`201`), the other was refused (`409`); `amount_paid_minor = 8000`, never 16 000.

### 3. Payment history and payables aging per supplier/branch reconcile to invoices and payments — PASS

- SQL invariants over the whole database: **every** `supplier_invoice.amount_paid_minor`
  equals the sum of its signed allocations (0 mismatches); **every** VOID invoice has a
  zero net allocation.
- For the walkthrough aging supplier, an independent SQL computation of outstanding and
  on-account reproduced the API's `invoiceOutstandingMinor`, `onAccountMinor`, and
  `owedMinor` exactly.
- Payment rows expose amount, allocated, and on-account totals; the console list and
  detail render the same split.
- Voiding a payment wrote an equal-and-opposite **RELEASE** row (`−4000`, with
  `reverses_allocation_id` set), flipped the invoice back to **OPEN** with
  `amountPaidMinor = 0`, and restored the owed balance by exactly the released amount;
  re-voiding → **409**; voiding an invoice with live allocations → **409**; an untouched
  invoice's supplier number could be re-entered after voiding.
- Aging: with `asOf = 2026-12-31`, five invoices landed in **exactly** Current
  (1 000), 1–30 (2 000), 31–60 (3 000), 61–90 (4 000), and 90+ (5 000); totals equalled
  the sum of supplier rows. The seeded `SINV-00002` (due 2026-10-22) sat in Current as of
  2026-10-20 and moved to 1–30 as of 2026-10-25 — the as-of parameter shifts buckets
  without mutating data. On-account remainders stayed outside the buckets.
- All Phase 5 audit actions were present, and the six new setting keys resolved through
  the settings API.

### 4. Supplied products list the supplier SKU and last cost — PASS

- Creating a mapping returned the **joined view** (`productSku`, `productName`,
  `supplierSku`, `leadTimeDays`, `lastCostMinor`, `isPreferred`); duplicates → **409**.
- Only one preferred supplier per product survived: marking the walkthrough supplier
  preferred for `GIK-00001` cleared the demo supplier's flag (SQL count = 1).
- Mapping an archived product → **409**; re-activating it allowed the mapping again.
- The console supplier detail rendered the product name/SKU, supplier SKU, lead time, and
  **last cost as a formatted `GHS` amount** (`05-supplier-products.png`).

## Console walkthrough (ADM-06) — PASS (25/25)

Admin (password + TOTP) created a supplier through the dialog (invalid phone `000000`
rendered the server message inline; a valid `024…` number saved and normalised), found it
by search, added BANK and MoMo details, switched the default (badge moved, exactly one
active default), mapped `GIK-00001` with a supplier SKU and saw its last cost, received
stock with the supplier picker, opened the receipt, and clicked **Record supplier
invoice** — the form pre-filled the receipt lines, total (`GHS 100.00`), and a non-zero
derived tax split. Saving produced an invoice whose detail showed the linked receipt and
no allocations. A partial payment with the allocation editor showed the **on-account**
remainder (`GHS 20.00`) and flipped the invoice to PARTIAL; the payment appeared in the
list with its Apply row. Voiding it returned the invoice to OPEN and showed the Release
row. The aging page listed the supplier's overdue bucket; the archive dialog explained the
outstanding balance (`15-archive-guard.png`), and after settlement the supplier archived.
Settings showed the **Suppliers & Payables** group; as manager the group was visible but
the global prefix Save button was disabled and the supplier list had no create control.

## Requirement trace

| Requirement | Implementation | Proof |
|---|---|---|
| SUP-01 supplier master, payment details, terms | `api/src/modules/suppliers`, console suppliers list/detail | walkthrough §1–2; browser steps 1–2 |
| SUP-02 supplier ↔ product mapping, last cost, lead time | `supplier_product` + `recordInvoiceCosts` + supplier detail panel | walkthrough §2; browser supplier products |
| SUP-03 supplier invoices (receipt + standalone, lines, totals) | `api/src/modules/payables` invoices; console invoice form/detail | walkthrough §3–4; browser receipt → invoice |
| SUP-04 payments with allocation to one or more invoices | `payables.service.createPayment` + allocation editor | walkthrough §5–6; browser partial payment |
| SUP-05 balance owed, payment history, aging | balances/aging service + endpoints; aging page | walkthrough §5–7; browser aging |
| ADM-06 suppliers console | Suppliers section tabs, Inventory Receipts tab, Settings group | browser 25/25 + screenshots |

## Locked decisions (D1–D18) as implemented

| # | As built |
|---|---|
| D1 | Global `supplier` with `SUP-#####`, E.164 phone normalisation, trigram name search + code; archive blocked at non-zero owed (409 names the amount); archived suppliers rejected by receipts/invoices/payments. |
| D2 | Multiple BANK/MOMO details with exactly one active default; nullable `paystack_recipient_code`; raw number only on the owning detail payload, `•••• last4` elsewhere/audit. |
| D3 | `supplier_product` unique pair, supplier SKU, lead time, last cost/at projection, one preferred supplier per product. |
| D4 | Receipt-linked and standalone invoices through one write path; nullable `stock_receipt.supplier_id`; free-text supplier fallback; `SINV-#####`; supplier number unique per supplier+branch among non-VOID. |
| D5 | Invoice-level tax; unit costs tax-inclusive when tax fields are omitted (`taxBreakdown` STANDARD/INCLUSIVE), zero or manual amounts otherwise; totals always recomputed. |
| D6 | `amount_paid_minor` and OPEN/PARTIAL/PAID recomputed in the payment/void transaction; VOID only at zero net allocation; overdue derived. |
| D7 | `PAY-#####`, CASH/BANK/MOMO, signed APPLY/RELEASE, Σ allocations ≤ amount, remainder on account, sorted invoice locks. |
| D8 | Reasoned voids keep history (RELEASE rows never updated); supplier numbers freed on invoice void; mappings removable; details deactivated. |
| D9 | Owed = invoice outstanding − payment remainder, derived on read; fixed aging buckets with as-of; on-account separate; `reconcilePayables()` implemented. |
| D10 | Supplier read/create/update/archive and payable read/manage/payment/void permissions; managers branch-scoped; cashiers none. |
| D11 | Six prefix/sequence settings, pad 5, allocated through `allocateFromSequence`. |
| D12 | Branch-scoped idempotency keys with replay; one invoice per receipt (partial unique index); supplier row locked before debts; invoice locks in sorted order. |
| D13 | Two modules in the seven-file layout; acyclic dependencies (`inventory → suppliers`, `payables → suppliers/inventory`). |
| D14 | Demo seed adds SUP-00001/2, details, four mappings, GRN links, SINV-00001 (partial PAY-00001), SINV-00002, PAY-00002 on account, sequences at 3 — idempotent. |
| D15 | Suppliers section (list/detail/invoices/payments/aging), Inventory Receipts tab + supplier picker, Settings group. |
| D16 | Permission-checked, branch-scoped routes; server-authoritative totals; masked account numbers; integer minor units; Zod everywhere. |
| D17 | All eleven action kinds audited in-transaction; walkthrough asserted each kind exists. |
| D18 | This document + the two scripts + 18 screenshots + logs. |

## Deviations from the plan

1. **Local PostgreSQL, not Docker.** The plan's `docker compose down -v` / `db:up` cycle
   was replaced with a schema reset of the operator-owned `gikautos_test` database on the
   local instance (operator directive; the `gikautos` role has no `CREATEDB`). The local
   `gikautos` database is the discarded prototype schema and was not touched by
   verification (beyond a failed migration attempt whose partial objects were removed).
2. **Test suite URL.** Tests read `TEST_DATABASE_URL` (default `:5433`); the run used the
   local `:5432` test database. Root `db:test:prepare` is Docker-specific and was bypassed
   with `bun run --filter api db:migrate`.
3. **Sequence offsets.** The demo seed already owns `SINV-00001/2`, `PAY-00001/2`, and
   `SUP-00001/2`; the walkthrough's first new supplier is `SUP-00003` (an archived probe),
   its working supplier `SUP-00004`, and its first invoice `SINV-00003`.
4. **API additions found during console verification (committed):**
   `ca41b50` payment list rows carry supplier/branch names; `9bd652a` supplier-product
   create/update return the joined view (product SKU/name); `951499f` invoice list filters
   by `receiptId`; the admin `ApiError` now exposes `details` for duplicate-invoice links.
5. **Browser script location.** Playwright is installed only in `/tmp/opencode`; the
   committed script was copied there for execution with `SHOTS_DIR` pointed at
   `evidence/`. It remains canonical in the repository.
6. **Aging as-of semantics.** Like Phase 4 credit aging, the as-of date shapes bucket
   boundaries from the current due dates; it is not a historical snapshot of allocations.

## Residual risks

- No component-level tests for the console; coverage is the Playwright flow plus
  check-types/build. A human visual pass is still advisable.
- Verification data lives in `gikautos_test`, which is reset for test runs; the scripts
  are fresh-DB-only and will not pass on a dirty database.
- Bank/MoMo numbers are masked outside the owning detail payload, but the full value is
  necessarily readable on the supplier detail screen (D16) — access is permission-gated.
- Paystack recipient codes and the `PAYSTACK` payment method are reserved for Phase 8;
  E-VAT remains a mock. Receipts/aging export formats land in Phase 8.
- The local `gikautos` database is the discarded prototype schema; there is currently no
  dedicated v1 dev database on the local instance. Create one (grant `CREATEDB` or run
  `createdb` as `postgres`), migrate, and seed before running the console locally; the
  Docker stack remains available as an alternative.

## Human verification checklist

- [ ] Enter a real supplier invoice from a paper document with a real product list;
      confirm the derived VAT/NHIL/GETFund split matches the supplier's invoice.
- [ ] Visually review the Suppliers list/detail, invoice form, payment dialog, aging, and
      receipts screens at 1280×800 and on a narrow window.
- [ ] Archive a supplier with a real debt and confirm the message reads clearly; settle
      and archive it.
- [ ] Sign in as a manager and confirm the supplier create/edit/archive controls and the
      global settings saves are unavailable.
- [ ] Verify a real Ghana phone number (`024…` and `+233…`) normalises on supplier save.
