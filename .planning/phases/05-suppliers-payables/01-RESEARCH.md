# Research — Phase 5: Suppliers & Payables

**Researched:** 2026-10-19 **Sources:** GRA VAT reforms page (gra.gov.gh/vat — Value Added
Tax Act 2025, Act 1151), Paystack developer documentation (Creating Transfer Recipients;
Single Transfers; Verify Account Number), Drizzle ORM 0.45 documentation (indexes,
constraints, migrations), PostgreSQL partial-index and locking guidance, this phase's 18
operator decisions (00-CONTEXT.md), and the verified Phase 2–4 codebase patterns
(`packages/shared` tax engine, settings sequences, credit ledger, inventory receipts).

## 1. Ghana 2026 VAT reforms and input tax

- The GRA page confirms the **Value Added Tax Act 2025 (Act 1151)**, effective
  **1 January 2026**: VAT is **15%** and NHIL **2.5%** + GETFund **2.5%**, all charged on
  the same base (20% total); the COVID-19 Health Recovery Levy was abolished; the flat
  rate schemes were removed; the goods registration threshold is GHS 750,000.
- Critically for this phase: the reforms **restored input tax deduction for NHIL and
  GETFund** ("Re-coupling of NHIL and GETFund Levy make the two levies now part of the
  VAT base again, restoring the ability to claim input tax credits on the two levies").
  A purchase-side payable therefore cannot store one opaque "tax" number if Phase 8 is
  to file the VAT and levies return: the invoice must keep **VAT, NHIL, and GETFund
  separately**.
- The same page states invoices must carry **separate lines for NHIL (2.5%), GETFund
  (2.5%), and VAT (15%)**, and returns are **monthly** (due the last working day of the
  following month). Suppliers must be identifiable by TIN/VAT number for the credit to
  be defensible under audit — hence `supplier.tin` / `supplier.vat_number`.
- The repository's `@gikautos/shared` tax engine already encodes exactly these rates
  (basis points 1500/250/250, single base) and documents Act 1151 in its source comment.
  `taxBreakdown(amount, 'STANDARD', 'INCLUSIVE')` guarantees
  `base + vat + nhil + getfund === total` with integer arithmetic (rounding residual
  added to VAT), which is why D5 can derive a purchase invoice split from a
  tax-inclusive receipt total without losing a pesewa.

## 2. Paystack Ghana: what Phase 8 needs and Phase 5 must store

- Ghana transfer recipients are created with type **`ghipss`** (bank account, GHS) or
  **`mobile_money`** (GHS/KES). The `recipient_code` returned is "the unique identifier
  for a user" and **"should be saved with the customer's records in your database"** —
  i.e. the supplier record, not reconstructed at transfer time.
- Telco codes are fetched from `GET /bank?currency=GHS&type=mobile_money`; the documented
  Ghana entries are **MTN**, **VOD** (Vodafone/Telecel), and **ATL** (AirtelTigo), passed
  as `bank_code` with the mobile number as `account_number`. Bank codes come from
  `GET /bank?currency=GHS` (GHIPSS), and the Bank of Ghana cannot receive transfers.
- Account numbers can be verified before first transfer with
  `GET /bank/resolve?account_number=…&bank_code=…` (free, Ghana supported). Phase 8
  should resolve on recipient creation; Phase 5 stores enough fields (account name,
  number, bank code / telco code + phone) to do it later without a schema change.
- Transfer references must be 16–50 chars, lowercase letters/digits/underscore/dash;
  retrying with the same reference avoids double crediting; final status arrives by
  webhook (`transfer.success` / `transfer.failed` / `transfer.reversed`) and can be
  polled at `GET /transfer/verify/{reference}`.
- Consequence for this phase: `supplier_payment_detail` carries BANK/MOMO fields and a
  nullable `paystack_recipient_code`; `supplier_payment.method` reserves a PAYSTACK value
  for Phase 8, and `supplier_payment` design already accommodates a later status extension
  (status enum COMPLETED/VOID now, PENDING/FAILED/REVERSED added in Phase 8).

## 3. Accounts-payable modelling in an append-only system

- **Three document types, one truth chain:** receipt → invoice → payment. The invoice is
  the payable: it is what increases amount owed (criterion 1). A goods receipt is
  evidence, not a debt; recording the invoice is the accounting event. This is why D4
  keeps invoice recording explicit (pre-filled from the receipt) rather than auto-creating
  debt on receiving.
- **Invoice outstanding is invoice-level, not FIFO-derived.** Unlike customer credit
  (where settlement is derived oldest-first because customers pay lump sums), suppliers
  are paid *per invoice*; the payment form's allocation IS the settlement. So the model
  stores signed allocation rows (APPLY/RELEASE) and projects `amount_paid_minor` — one
  projection, provable by sum, with no hidden allocation state.
- **Voids become compensating rows.** A payment that is cancelled posts RELEASE rows
  equal and opposite to its live APPLYs; an invoice can only be voided at zero net
  allocation. History is complete and the invariant
  `amount_paid_minor = SUM(signed allocations)` holds for every invoice at every moment.
- **On-account credit.** Real payments overshoot (advances, rounding, one bank transfer
  covering several invoices). Forcing exact allocation pushes operators to invent fake
  invoices. Allowing an unallocated remainder, shown explicitly per supplier, keeps the
  ledger honest; the owed balance formula subtracts it (D9).
- **Aging.** Standard payables aging buckets are **Current / 1–30 / 31–60 / 61–90 / 90+**
  days past due, per invoice, measured from the due date with an as-of date — identical
  to the Phase 4 receivables contract (D11 there), so the two reports read consistently.
  Unallocated payments are shown separately ("on account") rather than netted into
  buckets, which would silently cancel an overdue invoice in the report.
- **Duplicate supplier invoice numbers** are the classic double-payment fraud/error
  vector. A partial unique index per supplier+branch among non-VOID invoices (with the
  existing invoice id returned in the 409) prevents the entry; voiding frees the number
  for a corrected re-entry.

## 4. PostgreSQL and Drizzle mechanics verified for this schema

- Drizzle 0.45 supports all constraints this phase needs: `uniqueIndex(name).on(...)`
  `.where(sql\`…\`)` for **partial unique indexes** (already used for
  `customer_phone_unique` in migration 0004 and `loyalty_lot_expiry_idx`),
  `check(name, sql\`…\`)`, composite uniques, and self-referencing FKs
  (`reversesAllocationId`). `drizzle-kit generate` emits `WHERE` clauses natively; the
  repo's habit of appending extension DDL (`pg_trgm`) to a generated migration stays
  unchanged (`pg_trgm` already exists from migrations 0002/0004).
- Partial unique indexes are the right tool for the three "one live row" rules:
  - `supplier_payment_detail`: one active default per supplier
    (`WHERE is_default AND is_active`);
  - `supplier_invoice`: one invoice per receipt (`WHERE receipt_id IS NOT NULL`) and
    unique supplier invoice number among non-VOID
    (`WHERE status <> 'VOID'`);
  - `supplier_product`: one preferred supplier per product (`WHERE is_preferred`).
- **Locking order:** allocate against invoices by locking the invoice rows
  `SELECT … FOR UPDATE` in `id` order (deterministic, no deadlocks — Phase 3's sorted-lock
  pattern), then recompute `amount_paid_minor`/status and insert the allocation rows in
  the same transaction. Invoice/payment creation and supplier archive lock the supplier
  row first, serializing "archive" against "new debt".
- **Indexes for the read paths:** supplier name trigram GIN (search), `(branch_id, status,
  due_date)` on invoices for aging and overdue filters, `(supplier_id, status)`,
  `(branch_id, paid_at)` and `(supplier_id, paid_at)` on payments, `(invoice_id)` and
  `(payment_id)` on allocations. At the 5k-SKU/5-branch target these are comfortably
  interactive and keep aging a single index scan plus a sum.
- **Idempotency:** unique `(branch_id, idempotency_key)` on invoices and payments,
  consumed with the Phase 4 pre-check + unique-violation replay pattern, so console
  retries after a timeout cannot double-post a debt or a payment.

## 5. Reused infrastructure (verified in the codebase)

- `allocateFromSequence` / `peekSequenceValue` / `advanceSequencePast` in
  `api/src/modules/platform/settings.service.ts` — extend `SequenceKey` and
  `SEQUENCE_FORMATS` with supplier, invoice, and payment sequences (pad 5).
- `SETTING_DEFINITIONS` in `settings.validation.ts` — add the six new keys; global
  settings stay admin-only and validation stays Zod-driven.
- `PERMISSIONS`/`ROLE_PERMISSIONS` in `packages/shared/src/permissions.ts` — add the
  eight Phase 5 permissions with the D10 matrix; permission middleware and
  `resolveBranchFilter`/`assertBranchAccess` already exist in `api/src/http/`.
- `writeAudit` (must be called with the transaction executor, Phase 4 signature) and the
  audit reader already render before/after diffs.
- Phase 3 receipts: `stock_receipt` stores `supplierName` + `supplierInvoiceNumber`,
  `stock_receipt_line` links each product to its movement and cost; `GET /api/inventory/
  receipts` and `GET /api/inventory/receipts/:id` already exist (the console has no
  receipt screens yet — Plan 06 adds them). The demo seed's `ensureStockReceipt` creates
  GRN-00001 ("GikAutos Imports", INV-2026-001) and GRN-00002 ("Accra Parts Depot",
  APD-0451); Plan 01's seed links these names to supplier rows.
- Phase 4 patterns to mirror: the seven-file module layout, the profile/account
  `FOR UPDATE` projection discipline, idempotent replays, aging bucket construction,
  statement-style list screens, money dialogs keeping one idempotency key per form
  session, and evidence scripts under `phases/*/evidence/`.

## 6. Security notes applied to this phase (OWASP / ASVS L2)

- **A01 Broken access control:** every new route gets `requirePermission`; managers are
  branch-scoped on invoices, payments, and aging; master-data writes are admin-only;
  service functions re-check scoping (fail closed) rather than trusting routes.
- **A02/A04 Sensitive data:** bank/MoMo account numbers are masked in lists, audit
  snapshots, and logs (last 4 only); TLS terminates at Caddy in production; no payment
  secret is stored (Payload keys stay in Phase 8 env vars).
- **A05 Injection:** all queries through Drizzle parameter binding; Zod validation on
  every body/query/param; no dynamic SQL string building beyond `sql` template fragments.
- **A06 Insecure design:** server-authoritative totals and allocations; explicit guards
  (over-allocation, cross-supplier allocation, archive with debt, double invoicing);
  idempotency keys on money mutations.
- **A09 Logging:** audit rows for every mutation; the payments log never includes account
  numbers or references beyond the recorded `reference` field the operator typed.
