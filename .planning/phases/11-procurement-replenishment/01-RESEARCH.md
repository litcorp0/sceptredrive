# Phase 11 — Research notes (2026-10-25)

Sources consulted before planning. Every claim is either cited, verified in this repository with
a path and line reference, or marked as a decision (`00-DECISIONS.md`).

Versions in force: `drizzle-orm 0.45.4`, `drizzle-kit 0.31.11`, `hono 4.13.13`,
`@hono/zod-validator 0.9.1`, `zod 4.6.7`, PostgreSQL 17, Bun workspaces.

---

## PostgreSQL 17 — adding enum values is a two-migration problem

Sources: <https://www.postgresql.org/docs/17/sql-altertype.html>,
<https://www.postgresql.org/docs/12/release-12.html> (the relaxation),
`node_modules/drizzle-kit/bin.cjs:78922-78940` (verified in this checkout).

- The docs state: *"If `ALTER TYPE ... ADD VALUE` … is executed inside a transaction block, the
  new value cannot be used until after the transaction has been committed."*
- PostgreSQL 12 removed the old blanket ban; since then the statement runs inside a transaction
  but the label is invisible to the rest of it. Using it raises
  `ERROR: unsafe use of new value "…" of enum type …`.
- **This repository's migration runner wraps each file in a transaction.** The `pg` connector in
  `drizzle-kit` implements `transactionProxy` as `client.connect()` → `BEGIN` → each statement →
  `COMMIT` (or `ROLLBACK`), and `drizzle-kit migrate` applies each migration file through it.
- Therefore: a generated migration that adds `'SUPPLIER_RETURN'` to `stock_movement_type` *and*
  creates `supplier_return` (whose columns default to that label, or whose inserts use it) will
  fail. The enum additions get their own file, containing nothing else.
- Precedent that this works: `api/migrations/0007_common_next_avengers.sql:8-9` adds `'SALE'` to
  both movement enums and the rest of the file creates unrelated tables with no `'SALE'` DML.

**Applied in:** P11-D16, Plan 02.

---

## Drizzle 0.45 — transactions, locking, partial indexes

Source: <https://orm.drizzle.team/docs/transactions>

- `db.transaction(async (tx) => …)` with `{ isolationLevel, accessMode, deferrable }` is
  available (the same API Phase 9 verified in `node_modules/drizzle-orm/pg-core/session.d.ts`).
- Row locking is `.for('update')`, already used in eight repositories —
  `api/src/modules/inventory/inventory.repository.ts:71`,
  `payables/payables.repository.ts:197`, `suppliers/suppliers.repository.ts:72`,
  `transfers/transfers.repository.ts:62`, `credit/credit.repository.ts:34`,
  `org/enrollment.repository.ts:55`, `pos/pos.repository.ts:211,231`.
- Partial unique indexes are already in use, e.g.
  `payables.schema.ts` `unique(...).where(status <> 'VOID')` shapes and
  `suppliers.schema.ts` `uniqueIndex(...).where(is_preferred)`. The approval rule
  "one open approval per entity" is the same construct.
- `SUM(integer)` returns `bigint`, which node-postgres hands back as a **string**. The repository
  convention `.mapWith(Number)` is mandatory for every aggregate this phase adds
  (`inventory.repository.ts:104-129` is the reference).

**Applied in:** Plans 02, 03, 05, 07, 08.

---

## Three-way matching — the shape that survives contact with reality

Sources: Workday *Matching* (Procure-to-Pay), Oracle *Match Approval Level Options*,
Oracle *Invoice Tolerances*, Microsoft Dynamics 365 *Three-way matching*, Sage X3 *Matching
tolerance*, and the line-level state-machine write-up at <https://rivane.ai/blog/three-way-match-po-goods-receipt-and-vendor-invoice/>.

- Three-way matching compares **PO, receipt, invoice**; two-way is PO↔invoice only. Our D5 is
  deliberately **advisory**, which is a documented pattern: many organisations pay inside a
  tolerance and record the variance rather than holding the invoice.
- The control that makes matching worth anything is **line-level**, not header-level: *"Header
  approval hiding line variance"* is named as the failure a line-level join prevents. That is why
  `supplier_invoice_line.purchase_order_line_id` exists (P11-D5 in this doc's numbering is the
  UI; the schema refinement is in Plan 06).
- Quantity must be compared against **received** quantity, not ordered — invoicing goods that
  never arrived is the exact thing three-way matching exists to catch.
- Variances are separate signals: a price variance must not overwrite an unresolved quantity
  variance. Hence a single `match_status` enum that can say
  `PRICE_AND_QUANTITY_VARIANCE`, plus stored references so both values are readable.
- "Invoice before receipt" is a normal state, not an error (`OPEN_RECEIPT` in the reference
  model). Our equivalent is `QUANTITY_VARIANCE` with the received quantity still below the
  invoiced quantity, and the payable still posting (D5).

**Applied in:** Plan 06.

---

## Reorder points, min/max, and on-order quantity

Sources: NetSuite *Inventory and Assembly Item Support* (auto-calculated reorder point),
Rossetti *Analysis of Inventory Systems* ch. 3/8 ((s,Q) and (s,S) policies, inventory position),
MIT CTL.SC1x continuous-review notes, Inventory Mate *Suggested Restock*.

- The textbook inventory position is **on hand + on order − backorders**, and the reorder rule
  compares the *position*, not the shelf. That is the justification for subtracting `on_order`
  from the suggestion (D9) — without it, a manager orders the same part twice while the first
  order is in transit.
- NetSuite's auto reorder point is `demand/day × (lead time + safety days)`, and the "preferred
  stock level" is a separate, larger number. Our formula is the same shape, with `max_quantity`
  playing the role of the preferred level and `cover` able to raise it.
- A min/max policy is `(s, S)`: reorder at `s`, top up to `S`. `suggested = S − IP` is exactly
  D8's formula with `IP = on_hand + on_order`.
- Data-quality rule worth copying: when there is not enough history, do **not** silently
  auto-calculate a number that looks authoritative. NetSuite leaves the level alone. We label the
  row `lead time assumed` (P11-D12) and fall back to a stored level rather than inventing demand.
- Rounding: every reference rounds the suggested **quantity** up to whole units, at the end. No
  reference rounds intermediate demand.

**Applied in:** P11-D3, P11-D12, Plan 08.

---

## Supplier performance metrics and their dates

Sources: Oracle *Understanding Supplier Performance Metrics*, Amazon Business *Supply chain KPIs*,
the OTIF definitions in the LCBO vendor programme, the Cartograph supplier-scorecard date rules,
and AWS Supply Chain *On-time in-full / Supplier fill rate*.

- **OTD** is `on-time deliveries ÷ deliveries due`; **OTIF** adds the quantity condition.
  Industry practice measures both at **PO line** level, because a header-level average hides the
  one line that mattered.
- **Lead time** is `receipt date − PO release (sent) date`, not the requisition date. That is why
  `SENT` has to be a real timestamp (P11-D4).
- **On time** means "on or before the agreed date"; early counts as on time in every one of these
  sources. Grace windows exist but are a policy choice; we ship zero grace and exclude lines with
  no promised date, showing the exclusion.
- **Fill rate** is `received ÷ ordered`, optionally capped at 1.0 so an over-delivery cannot
  flatter a supplier. We cap it.
- **Lead-time spread matters more than the average** — a supplier that reliably takes 10 days is
  easier to plan than one that averages 7 and swings 3–14. Phase 11 ships the average and the
  count; spread is recorded as a carry-forward rather than half-built.

**Applied in:** P11-D11, Plan 08.

---

## OWASP — the acceptance criteria for this phase

Source: the `owasp-security` skill, OWASP Top 10:2025, ASVS 5.0 L2.

| Risk | Requirement in this phase | Where proven |
|---|---|---|
| A01 Broken access control | Every route `requirePermission`; every service `assertBranchAccess`; IDOR returns 403 (P11-D17) | Plans 03–08 tests; Plan 11 walkthrough |
| A01 (privilege) | `procurement.approve` is admin-only; a manager cannot approve any order, including their own branch's | Plan 03 tests |
| A05 Injection | All SQL through Drizzle builders/`sql` templates with bound parameters; no string-built SQL for the suggestion or performance queries | Plans 08 review + tests |
| A06 Insecure design | Threshold falls back to the default when unset, never to "no approval needed"; self-approval has no code path (P11-D18) | Plan 03 tests |
| A08 Integrity | Append-only ledgers; approvals immutable; a POSTED return has no edit path | Plans 05, 07 |
| A09 Logging | Every state change audited with before/after; no PII, no tokens in logs | Plans 03–08 |
| A10 Exceptional conditions | Branch resolution fails closed; a missing supplier/branch/product is a typed 4xx, never a silent skip | All plans |

Mass-assignment rule: every request body is a `.strict()` Zod object (the repository convention,
e.g. `inventory.validation.ts:9-13`) and is mapped field by field into the insert. No request
object is ever spread into a Drizzle `values()`.

---

## Verified repository facts used by the plans

| Fact | Where |
|---|---|
| Seven-file module layout, `routes → validation → controller → service → repository` | `AGENTS.md`; every module in `api/src/modules/` |
| `postMovements` is the **only** stock writer; inbound requires positive qty + cost | `api/src/modules/inventory/inventory.service.ts:113-186` |
| `createReceipt` allocates `inventory.receiptSequence`, posts movements, writes lines, audits `stock_receipt.created` | `inventory.service.ts:313-397` |
| `stock_receipt` has no status/quantity and no PO link; `stock_receipt_line` is unique per `(receipt_id, product_id)` | `inventory.schema.ts:124-166` |
| `stock_threshold` is `(product_id, branch_id, threshold)` only | `inventory.schema.ts:99-121` |
| `stock_movement_type`/`reference` have no `SUPPLIER_RETURN` | `inventory.schema.ts:15-39` |
| `averageCostAfterReceipt` is shared and rounds half-up once | `packages/shared/src/inventory.ts:16-40` |
| `recordInvoiceCosts` only updates **existing** `supplier_product` rows — unmapped products no-op | `suppliers.service.ts:648-660` |
| `updateLastCost` takes `(supplierId, productIds, costByProduct, occurredAt, executor)` | `suppliers.repository.ts:311` |
| `sumSupplierOwed` reads payables tables directly (schema-level seam) | `suppliers.repository.ts:345` |
| Preferring a supplier clears the previous preferred row (`clearPreferredSupplierProduct`) | `suppliers.repository.ts:300` |
| `supplier_invoice` has no `purchase_order_id`; partial unique on `receipt_id` and on `(supplier, branch, vendor number)` | `payables.schema.ts:54-100` |
| `supplier_invoice_line` partial unique `(invoice_id, product_id)` | `payables.schema.ts:103-124` |
| Supplier balance = outstanding invoices − on-account credit; aging excludes on-account | `payables.service.ts:757-830`, `payables.repository.ts:593-676` |
| Invoice creation is idempotent before and inside the transaction | `payables.service.ts:161-164, 248-251` |
| `product.cost_price_minor` is writable on create and update today | `products.service.ts:159, 253` |
| `archiveProduct` blocks while any stock is on hand | `products.service.ts:296` |
| Settings declarations are one literal with `{schema, defaultValue, branchScoped}` | `platform/settings.validation.ts:5-217` |
| `updateSetting` lets a manager write any `branchScoped` key for their own branch | `settings.service.ts:84-166` |
| `allocateFromSequence` is one static prefix + one padded counter in a single `setting` row | `settings.service.ts:244-275` |
| `SequenceKey` has nine members; adding one needs `SEQUENCE_FORMATS` + two setting keys | `settings.service.ts:172-237` |
| `writeAudit(entry, executor)` is called inside the service transaction, action `entity.verb` | `platform/audit.service.ts:11` |
| `resolveBranchFilter` throws 403 for a foreign branch; `assertBranchAccess` for single documents | `auth/scope.ts:22-45` |
| `requirePermission(permission)` denies by default | `http/authorize.ts:15` |
| Module mounts are one `app.route('/', xRoutes)` per module | `api/src/app.ts:43-66` |
| Seeding helpers exist for supplier, supplier product, receipt, threshold, invoice, setting, sequence | `api/src/seed/helpers.ts:376,465,533,635,671,157,843` |
| Purchase-order-shaped receipts are already built in the console | `admin/src/modules/inventory/components/receive-dialog.tsx` (296 lines) |
| Line editors to copy | `inventory/components/transfer-lines-editor.tsx`, `payables/components/invoice-lines-editor.tsx` |
| Admin module gate: `REQUIRED_MODULES` is a hard allow-list | `scripts/check-modules.mjs:39-55,168-171` |
| Route files are ≤25 lines with exactly one module barrel import | `scripts/check-modules.mjs:94,111-167` |
| `NavPath` is a closed union; nav is permission-filtered; breadcrumb shares the table | `admin/src/components/layout/sidebar.tsx:36-145,194-223` |
| Available primitives include `dialog, alert-dialog, select, table, tabs, switch, popover, command, calendar, tooltip, empty` — **no** `form`, `checkbox`, `radio-group`, `progress` | `admin/src/components/ui/` |
| Admin has **no unit tests**; its gate is `admin/test/walkthrough-sections.mjs` (`SECTIONS` at :134) | `admin/package.json`, `admin/test/walkthrough-sections.mjs` |
| API tests are colocated, `describe.skipIf(!available)`, shared `api/test/integration.ts` helpers | `api/src/modules/*/*.test.ts` |
| `bun run test` is the only correct suite command | `AGENTS.md` (bare `bun test` uses Bun's runner) |

---

## Documentation defects found while planning

1. `00-CONTEXT.md` D7 specifies `reorder_quantity` with a default that is a function of live
   stock; D8's formula then computes the same concept independently. Resolved by P11-D3.
2. `00-CONTEXT.md` D11 says numbering uses "the existing settings sequence machinery". That
   machinery cannot express branch+month. Resolved by P11-D15, and the contradiction is named
   rather than quietly worked around.
3. `00-CONTEXT.md` D5 puts the PO link on the invoice header only; line-level variance (which
   the same sentence requires) needs a line-level link. Added in Plan 06.
4. `AGENTS.md` still says `bun test` in the "Test command" note header while the note itself says
   `bun run test`. Cosmetic; corrected in Plan 11's documentation pass.
