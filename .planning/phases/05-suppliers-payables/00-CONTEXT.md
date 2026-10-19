---
phase: 05-suppliers-payables
name: Suppliers & Payables
depends_on: [01-foundation, 02-catalog-pricing, 03-inventory-transfers, 04-customers-credit]
requirements: [SUP-01..05, ADM-06]
status: planned
created: 2026-10-19
---

# Phase 5 — Suppliers & Payables — Locked Context

**Goal:** Suppliers, the products they supply, invoices on credit, payments, and balances
are tracked accurately per branch and in aggregate.

This document records the decisions taken with the operator before writing the plans.
It overrides convenience in any later plan.

## Locked Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Supplier master | Global `supplier` table, server-allocated code `SUP-#####` (sequence + prefix settings), name (required), contact name, phone (E.164 via `normalizeGhanaPhone`), email, address, TIN, VAT number, payment terms in days (≥ 0, default 0 = due on demand), notes, `status` ACTIVE/ARCHIVED. Search by name trigram + code. Archive blocked while the supplier's owed balance is non-zero (409 names the amount); archived suppliers cannot be picked for new receipts, invoices, or payments | SUP-01; mirrors Phase 3 archive guards; duplicate-free master data |
| D2 | Supplier payment details | `supplier_payment_detail` rows, one supplier → many details: method `BANK`\|`MOMO`; BANK carries account name, account number, bank name, bank code (Paystack GHIPSS code, free text until Phase 8 fetches the live list); MOMO carries network (`MTN`\|`VOD`\|`ATL`, the Paystack Ghana telco codes) and phone (E.164). `label`, `is_default`, `is_active`, and a nullable `paystack_recipient_code` reserved for Phase 8 transfers. Exactly one active default per supplier (partial unique index); deactivate, never delete. Account numbers are masked in lists and audit entries (last 4 only) and never logged | SUP-01 "payment details (MoMo/bank)"; Paystack transfer-recipient contract; OWASP A02/A09 |
| D3 | Supplier products | `supplier_product` mapping: supplier + product (unique pair), `supplier_sku`, `lead_time_days`, `last_cost_minor` + `last_cost_at` (projection updated when invoice lines are recorded), `is_preferred` (at most one preferred supplier per product, partial unique index). Managed in the supplier detail screen; read by the console lists | SUP-02; criterion 4 ("supplied products list the supplier SKU and last cost") |
| D4 | Invoice recording | Two paths, one write path: **from a receipt** (the receipt detail screen offers "Record supplier invoice"; lines, quantities, costs, and the branch pre-fill from the receipt and both records link) and **standalone** (freight, services, opening debts). `stock_receipt` gains a nullable `supplier_id`; the receive dialog can pick a supplier from the master (free-text name stays as fallback). Internal invoice number `SINV-#####`; the supplier's own invoice number is required and unique per supplier+branch among non-VOID invoices (409 returns the existing invoice id) | SUP-03; roadmap criterion 1; operator decision — goods arrive before invoices often, and freight/services never have a receipt |
| D5 | Invoice lines and totals | `supplier_invoice_line`: product (nullable) or description, quantity, unit cost; `line_total = quantity × unit_cost`, `subtotal = Σ lines`, all server-computed integers. Tax is invoice-level: `vat_minor`, `nhil_minor`, `getfund_minor` (collectively the input tax), `total = subtotal + tax`. When tax fields are omitted the service derives the split from the subtotal with the shared Ghana engine (`taxBreakdown`, STANDARD, INCLUSIVE — so the invoice total equals the tax-inclusive costs entered, exactly what the receipt said); operators can zero the tax (non-registered suppliers) or enter custom amounts. No line-level tax math | SUP-03 "lines, totals"; Act 1151 (2026 VAT reforms) keeps VAT 15% + NHIL 2.5% + GETFund 2.5% on one base and restored input credit on the levies, so the split matters for Phase 8 RPT-02 |
| D6 | Invoice status projection | `amount_paid_minor` = sum of signed allocations (projection); status `OPEN` → `PARTIAL` → `PAID` recomputed inside every payment/void transaction; `VOID` is explicit and only allowed while the net allocation is zero. Overdue is derived (`due_date < as-of` and status OPEN/PARTIAL), never stored | SUP-03 "amount paid, status"; projection + reconciliation pattern of Phases 3–4 |
| D7 | Payments and allocations | `supplier_payment`: number `PAY-#####`, supplier, branch, method `CASH`\|`BANK`\|`MOMO` (`PAYSTACK` reserved for Phase 8), amount > 0, reference, `paid_at`, optional payment detail used, status COMPLETED/VOID, idempotency key. `supplier_payment_allocation` is append-only and signed: `APPLY` (+amount) and `RELEASE` (−amount, references the released allocation). Σ allocations ≤ payment amount; an unallocated remainder is allowed and shown as "on account". Allocations cannot exceed an invoice's outstanding, must reference non-VOID invoices of the same supplier, and (for managers) invoices of their own branch. Invoice rows are locked `FOR UPDATE` in id order before allocation so parallel payments cannot over-apply | SUP-04 "allocation to one or more invoices"; operator decision (unallocated remainder allowed); Phase 3 D16 sorted-lock pattern |
| D8 | Corrections | Void with reasons, history kept. **Payment void** (`DUPLICATE`\|`ERROR`\|`RETURNED`\|`BANK_REVERSAL`\|`OTHER`): writes a RELEASE allocation per live amount, flips invoices back (amount paid + status), sets payment status VOID — rows are never deleted. **Invoice void** (`DUPLICATE`\|`CANCELLED`\|`ERROR`\|`OTHER`): only with zero net allocations (409 otherwise); a voided invoice's supplier number is freed for re-entry. Payment details deactivate; supplier-product mappings may be removed (metadata, audited) | Operator decision; auditability without mutable ledgers |
| D9 | Balances and aging | Derived on read, never stored: per supplier+branch, owed = Σ(non-VOID invoice total − amount paid) − Σ(non-VOID payment remainder), with the on-account remainder shown as its own line. Aging buckets: Current (not yet due) / 1–30 / 31–60 / 61–90 / 90+ days past due, measured from `due_date` with an as-of parameter; only invoices with outstanding > 0 appear; branch totals = sum of supplier rows. Managers see their branch only; admin sees all or one. `reconcilePayables()` (read-only) proves invoice `amount_paid_minor` = Σ signed allocations, status validity, VOID invoices at zero, and supplier owed = invoices − on-account | SUP-05; Phase 4 D11 aging contract; money must be provable |
| D10 | Permissions (new) | `supplier.read` (admin+manager), `supplier.create`, `supplier.update`, `supplier.archive` (admin only), `payable.read`, `payable.invoice.manage`, `payable.payment`, `payable.void` (admin all; manager all, branch-scoped); cashier none. Recording, voiding, and allocating are branch-scoped through `resolveBranchFilter`/`assertBranchAccess` | Operator decision; mirrors Phase 4 D20 authority split |
| D11 | Settings and sequences | `supplier.codePrefix` (default `SUP`) + `supplier.codeSequence`; `payable.invoicePrefix` (default `SINV`) + `payable.invoiceSequence`; `payable.paymentPrefix` (default `PAY`) + `payable.paymentSequence`; pad 5, allocated with `allocateFromSequence` | SUP-03; Phase 3 D11 sequence mechanism; human-readable references |
| D12 | Idempotency and concurrency | `supplier_invoice` and `supplier_payment` carry a client-generated idempotency key unique per branch; a replay returns the existing record (pre-check + unique-violation replay inside the transaction, Phase 4 D23). A partial unique index on `supplier_invoice.receipt_id` allows one invoice per receipt. The supplier row is locked `FOR UPDATE` before archive and before invoice/payment creation so archiving cannot race new debts. Invoice allocations lock invoice rows in sorted order. Status and amount-paid recomputation happens in the same transaction as each allocation write | SUP-03/05; POS/console retry safety; no double-posting |
| D13 | Module layout | Two API modules in the seven-file layout: `suppliers` (master, payment details, product mappings, last cost), `payables` (invoices, payments, allocations, balances, aging). Dependency direction (acyclic): `inventory → suppliers` (validate the supplier on receipt), `payables → suppliers` + `payables → inventory` (receipt lines), `suppliers → products`. Routes: `/api/suppliers…` and `/api/payables…`, wired in `app.ts` | SUP-01..05; matches AGENTS.md and Phases 2–4 |
| D14 | Demo seed | Idempotent `db:seed --demo` additions: two suppliers named to match the existing demo receipts (`Accra Parts Depot`, `GikAutos Imports`) with bank + MoMo details and terms; `supplier_id` linked onto GRN-00001/GRN-00002; four product mappings with supplier SKUs and last costs; `SINV-00001` recorded from GRN-00002 with the derived 20% split and a partial `PAY-00001`; one standalone freight invoice; one payment with an unallocated remainder; supplier/invoice/payment sequences advanced past the seeded values | Phase 3/4 D18 pattern; a browsable AP story on a fresh database |
| D15 | Console | New **Suppliers** section (sidebar, `Truck` icon) with tabs Suppliers / Invoices / Payments / Aging: supplier list (search, archived toggle), supplier detail (contact + terms, payment details, supplied products with supplier SKU/last cost), invoice list (filters supplier/status/branch/overdue/date) and detail (lines, tax split, linked receipt, allocations, record payment, void), payment list + detail (allocations, void), aging view (as-of date). Inventory gains a **Receipts** tab (list + detail) with the "Record supplier invoice" action; the receive dialog gains a supplier picker. Settings gains a Suppliers/Payables group for the prefixes and sequences. Dense ops styling per Phase 2–4 | ADM-06; roadmap criterion 1 |
| D16 | Security and data handling | Supplier bank/MoMo details are sensitive: masked in lists and audit, full value only on the supplier detail screen, never in logs or API envelopes beyond the owning endpoints. Every route is permission-checked and branch-scoped server-side; totals are recomputed server-side and never trusted from the client; Zod validates every input; money stays integer minor units; failed authorization fails closed | OWASP A01/A02/A04/A05/A09, ASVS L2; AGENTS.md rules 3–5 |
| D17 | Audit | Every mutation is audited in the same transaction with the established `writeAudit` shape: `supplier.created/updated/archived/reactivated`, `supplier_payment_detail.created/updated`, `supplier_product.created/updated/deleted`, `supplier_invoice.created/voided`, `supplier_payment.created/voided` | FOUND-10 continuity; Phase 4 D-audit pattern |
| D18 | Verification contract | Fresh-DB cycle; API + SQL walkthrough asserting the derived tax split (`subtotal + vat + nhil + getfund` equals the tax-inclusive receipt total), invoice-from-receipt linkage both directions, duplicate supplier invoice number 409, idempotent replays, partial-payment arithmetic, over-allocation and cross-supplier/allocation guards, void semantics (release rows, invoice flips, guards), aging buckets against an as-of date, `reconcilePayables()` and raw SQL reconciliation, permission/branch 403 matrix, archive guard; browser walkthrough over the dialogs; scripts and screenshots under `phases/05-suppliers-payables/evidence/` | Phase 4 Plan 08 pattern; goal-backward proof |

## Refinements to approved answers (flagged for operator review)

Three mechanics were pinned during planning; intent is unchanged:

1. **D5 tax derivation basis:** the invoice pre-filled from a receipt treats the recorded
   unit costs as tax-inclusive and derives the split with the shared engine, so
   `total = subtotal + VAT + NHIL + GETFund` equals the receipt total exactly. Operators
   can zero the tax or enter custom amounts; there is no line-level tax.
2. **D9 aging vs. on-account:** unallocated payment remainders are not netted into aging
   buckets (buckets show invoice outstanding by due date); they appear as a separate
   "On account" figure per supplier and reduce the supplier's owed balance.
3. **D10 void authority:** `payable.void` is granted to managers for their own branch
   (payment entry mistakes must be fixable at the till-side office without an admin),
   while master-data authority stays admin-only.

## Architectural Invariants (do not violate)

- **Server is authoritative for money.** Subtotal, tax split, total, amount paid,
  outstanding, status, and owed balances are computed in the API from validated inputs;
  the console only renders.
- **Allocations are append-only.** APPLY/RELEASE rows are never updated or deleted;
  invoice `amount_paid_minor` and status are projections recomputed in the same
  transaction as each write and provable by `reconcilePayables()`.
- **Integers everywhere.** Pesewas and quantities are integers; no floats in any money path.
- **Fail closed.** Permissions and branch scope are checked before any read of another
  branch's records; unknown suppliers/invoices/payments 404; guards win over convenience.
- **No sensitive data leaks.** Bank/MoMo account numbers are masked in logs, audit
  snapshots, and list responses; audit records identifiers and the last 4 digits.
- **One write path per document.** Invoices are created only through
  `payables.service.createInvoice` (with or without a receipt); payments only through
  `payables.service.createPayment`; corrections only through the void paths.

## Verified Research (see 01-RESEARCH.md)

- GRA's 2026 VAT reforms (Value Added Tax Act 2025, Act 1151, effective 2026-01-01):
  VAT 15% + NHIL 2.5% + GETFund 2.5% on one base; COVID-19 levy abolished; **input
  credit restored on NHIL/GETFund**, so purchase invoices must store the split; invoices
  must show NHIL, GETFund, and VAT as separate lines; monthly returns.
- Paystack Ghana transfers: recipient types `ghipss` (bank) and `mobile_money`
  (telco codes from `GET /bank?currency=GHS&type=mobile_money` — documented MTN, VOD,
  ATL); `recipient_code` must be saved with the supplier record; bank account resolution
  via `GET /bank/resolve?account_number&bank_code`; transfers are reconciled from
  webhooks on the same reference. Phase 8 consumes the fields this phase stores.
- Drizzle ORM 0.45: partial/unique indexes via `uniqueIndex(...).on(...).where(sql\`…\`)`,
  `check()` constraints, composite uniques — all already used in this repo.
- PostgreSQL: partial unique indexes enforce "one live row" rules (default payment
  detail, one invoice per receipt, duplicate supplier invoice numbers among non-VOID);
  `FOR UPDATE` on sorted invoice rows is the established allocation-safety pattern
  (Phases 3–4).
- Accounts-payable practice: invoice-level outstanding by due date for aging; explicit
  payment-to-invoice allocation (payments are not silently applied FIFO); unallocated
  credit shown separately; goods-receipt ↔ invoice matching is the control that prevents
  paying for goods never received.

## Bootstrap Order

> **Execution notes:** load `hono` before the API plans (02–04),
> `supabase-postgres-best-practices` before schema/query work (01, 04),
> `web-design-guidelines` / `frontend-design` before the console plans (05–06), and
> `owasp-security` throughout (AGENTS.md mandate). `powersync` is not needed in Phase 5 —
> no sync surface changes.

1. Schema (suppliers, payment details, supplier products, invoices, invoice lines,
   payments, allocations, `stock_receipt.supplier_id`), migration, settings, sequences,
   permissions, demo seed (Plan 01).
2. Suppliers module: master CRUD + archive guard, payment details, product mappings,
   last cost (Plan 02).
3. Payables module: invoices from receipts and standalone, lines, totals with the derived
   tax split, dedupe, void, idempotency (Plan 03).
4. Payments, allocations, voids, supplier balances, aging, reconciliation (Plan 04).
5. Console — Suppliers section: list, detail, payment details, products, settings group
   (Plan 05).
6. Console — Invoices (list/detail, record payment, void), Payments, Aging; inventory
   Receipts tab with "Record supplier invoice"; receive dialog supplier picker (Plan 06).
7. Phase verification: walkthroughs, evidence, state update (Plan 07).

## Open Items (carry into later phases)

- Phase 8: Paystack supplier transfers (recipient creation from `paystack_recipient_code`,
  transfers + webhooks, transfer status in `supplier_payment`), payment reconciliation
  report, payables aging CSV/PDF export, tax report consuming the invoice tax split.
- Phase 8: payables aging within the reports suite (RPT-05) reuses `GET /api/payables/aging`.
- Phase 9: consider at-rest encryption for payment details if the DB volume is not
  already encrypted; DPA-style handling of supplier personal data (MoMo names/numbers).
- Phase 7: POS does not touch suppliers; no sync contract is added in Phase 5.
