# Phase 11 — Decisions taken during planning (2026-10-25)

These refine `00-CONTEXT.md`. Where a refinement contradicts the locked context, the refinement
wins and the context is amended in Plan 11's state update.

Read P11-D1…D5 first: they were put to the operator as questions and answered. The rest are
planning decisions this document records so execution does not re-litigate them.

---

## P11-D1 — A return posts its credit note in the same transaction

**Decision (operator, 2026-10-25):** posting a `supplier_return` posts the negative stock
movement **and** creates its `supplier_credit_note` in one transaction. The supplier balance
drops at that moment. The supplier's own credit-note number is an optional field on the return
(`supplier_credit_note_number`), not a second document that has to arrive first.

**Why:** `00-CONTEXT.md` D6 says a return is "settled by a credit note that reduces the supplier
balance". Two documents with a waiting state between them would mean a returned item could sit
for weeks in "goods gone, payable unchanged", and the payables screen would show money owed for
stock the branch no longer has. One transaction keeps `invoice + credit note = balance` true at
every instant (the invariant in D6 and PROC-08).

**Consequences:**
- `supplier_credit_note` is 1:1 with a `POSTED` return (`unique(return_id)`), numbered
  `SCN-{BRANCHCODE}-{YYYYMM}-{NNNN}`.
- If the supplier disputes the return, the correction is a **compensating** document, never an
  edit. A `DRAFT` return can be cancelled; a `POSTED` one cannot.
- A return is capped at `received − already returned` per receipt line, computed inside the
  transaction with `FOR UPDATE` on the receipt line's aggregate. Over-return is rejected, not
  clamped.

---

## P11-D2 — The approval threshold compares the ex-tax goods value

**Decision (operator, 2026-10-25):** the threshold compares `Σ(quantity × unit_cost_minor)` —
the goods value before VAT/NHIL/GETFund. The screen shows the tax estimate for information and
labels the gate "Goods value (ex-tax)".

**Why:** input VAT is recoverable, so the commitment the owner is approving is the cost of the
goods. It also removes a hidden dependency on `tax.mode`: an inclusive-price setting would
otherwise move the effective approval limit to GHS 8,333.33 without anyone changing the
threshold.

**Consequences:** `purchase_order` stores **no** money columns. The goods value is
`sum(quantity * unit_cost_minor)` over its lines, computed in SQL (integer multiplication, exact
in PostgreSQL for these magnitudes) and again in the service before the decision. A stored total
would be a second truth that drifts on every draft edit.

---

## P11-D3 — Reorder quantity becomes a minimum order quantity

**Decision (operator, 2026-10-25):** `00-CONTEXT.md` D7's `reorder_quantity` is **dropped**.
`stock_threshold` gains:

| Column | Type | Default | Meaning |
|---|---|---|---|
| `max_quantity` | integer null | `2 × threshold` (backfilled) | the level to top up to |
| `min_order_quantity` | integer not null | `0` | a supplier's minimum; a floor on the suggestion |

```
suggested = max( clamp(max_level − on_hand − on_order, 0, max_level), min_order_quantity )
```

**Why:** D7's `reorder_quantity` defaulted to `max − on hand`, which is a snapshot of a number
that changes every time something sells. Stored, it is wrong by the next sale; recomputed, it is
just D8's formula with another name. A minimum order quantity is a real, stable supplier
constraint and is the only quantity in this area that genuinely belongs in a column.

**Consequences:** `ThresholdInput` gains both fields (Plan 02); the existing threshold dialog
gains two inputs (Plan 10); nothing else reads `reorder_quantity` because it never existed.

---

## P11-D4 — `SENT` means "recorded as sent", and prints

**Decision (operator, 2026-10-25):** `SENT` records `sent_at` / `sent_by` and unlocks a printable
PO sheet (`window.print()` over a print-styled section, plus a CSV download). No email is sent,
no template is added, no Resend call is made.

**Why:** procurement is online-only and a manager in Ghana will WhatsApp or hand the sheet to the
supplier. An email path would add a provider, a failure state and a retry story to this phase for
a delivery channel the business does not use. The `SENT` state still earns its place because
D10's actual lead time is measured from it (`first_receipt − sent_at`), and no other timestamp can
stand in for "the supplier was told".

**Consequences:** the PO detail page carries a print stylesheet and a CSV export. Phase 15 may
add email without changing the model.

---

## P11-D5 — Phase 11 ships a PO queue, not the unified inbox

**Decision (operator, 2026-10-25):** approve/reject lives on the purchase-order detail, and the
order list filters to `status=PENDING_APPROVAL` for the admin. There is no multi-type approval
inbox in this phase.

**Why:** `ROADMAP.md` Phase 12 criterion 2 owns "one approval inbox" spanning transfers,
write-offs, price changes, credit limits, shift variances and refunds. Building it here would
mean building it twice, or freezing a design Phase 12 must extend. The `approval` entity is
shared and already carries `type`, so Phase 12 adds a list view, not a migration.

---

## P11-D6 — An auto-approved order writes no approval row

**Decision:** below-threshold manager orders go `DRAFT → APPROVED` and write an audit entry
`purchase_order.auto_approved`. No `approval` row is created.

**Why:** an `approval` row with `decided_by = null` is an unapproved approval. The inbox would
have to filter it out forever and any report counting approvals would be wrong. The audit log is
the correct home for "the threshold allowed this without a human".

**Consequences:** `purchase_order.approval_id` is nullable and stays null for auto-approved
orders. The order detail shows *"Approved automatically under the GHS 10,000 limit"* with the
threshold value read at submit time from the audit entry.

---

## P11-D7 — The admin approves a submitted product exactly as submitted

**Decision:** a `PRODUCT_CREATE` approval carries the proposed product in
`approval.payload` (name, category, brand, unit, proposed base price, description, supplier).
Approval creates the product from that payload verbatim. There is no edit-in-place during the
decision.

**Why:** a decision that silently changes what was requested is not a decision — the manager
would never know their price was altered. The admin already has `catalog.update`, so a
post-approval correction is a second, audited fact.

**Consequences:** to change anything, the admin rejects with a reason code and the manager
resubmits. The approval is one-shot: a decided approval is immutable.

---

## P11-D8 — Write-off requests stay in Phase 12

**Decision:** Phase 11 builds the **purchase return** only. `MGR-04`'s "request a stock
write-off" and `BRN-*`'s write-off approval land in Phase 12, which already owns them
(`ROADMAP.md` Phase 12 criterion 4).

**Why:** a write-off moves stock that never had a supplier. Modelling it as a supplier return
would corrupt the payables ledger; modelling it as a second stock-write path would break D4's
"no new stock write path" rule. The `approval` entity accepts the new type without a migration
(P11-D14).

---

## P11-D9 — Credit notes reduce what is owed, never the aging buckets

**Decision:** a credit note is subtracted in `owedMinor` and reported as its own column
(`creditMinor`). It is **not** bucketed in the aging report.

**Why:** this is already the rule for on-account credit (`payables.service.ts:810-830`, D9 of
Phase 5: "on-account credit is reported per supplier but never netted into the buckets"). A
credit note is not an invoice with a due date; putting it in a bucket would invent one.

**Consequences:** `suppliers.repository.sumSupplierOwed` (used to block archiving a supplier)
must subtract credit notes too, or a fully-returned supplier could be archived while still
showing a balance. That is a tested invariant, not a comment.

---

## P11-D10 — Preferred supplier and lead time are global, not per branch

**Decision:** replenishment groups by the product's **preferred** `supplier_product` row.
`supplier_product` has no `branch_id`, so lead time is global. A product with no preferred
supplier appears in an **Unassigned** group and cannot become a PO line until one is chosen.

**Why:** the schema says what it says. Pretending a lead time is per-branch would require a
schema change that is not in this phase, and inventing a default-per-branch would be a number
nobody can trace.

**Consequences:** the Unassigned group's row action is "Choose supplier", which opens the
existing `supplier-product-dialog`. The PO-from-suggestions action skips unassigned groups and
says how many lines it skipped.

---

## P11-D11 — Performance is measured per PO line, with stated dates

**Decision:**

| Metric | Definition |
|---|---|
| On-time rate | lines whose **first** receipt is on or before `purchase_order.expected_date`, ÷ lines with both a receipt and an expected date. Early counts as on time |
| Fill rate | `Σ received quantity ÷ Σ ordered quantity` over lines whose order is `RECEIVED`, `CLOSED` or `PARTIALLY_RECEIVED` |
| Promised lead time | `expected_date − sent_at` in days |
| Actual lead time | first receipt date − `sent_at`, in days |
| Last-cost drift | latest receipt unit cost − previous receipt unit cost for the same `supplier_product`, in minor units and as a percentage of the previous (integer basis points, using the existing `percent.ts` helpers) |

**Why:** these are the definitions every scorecard uses (Oracle's On-Time/Quantity metrics,
D365's three-way match, the OTIF literature), and each one names a date. "On time" without a
named date is the argument that makes supplier scorecards distrusted.

**Consequences:** a line with no `expected_date` is excluded from on-time rate and counted in a
`noPromise` column, so the denominator is visible. An order with no `sent_at` is excluded from
lead-time figures.

---

## P11-D12 — Velocity and the suggestion are integer arithmetic, rounded once

**Decision:**

```
velocityDays = 90                        (a constant in @sceptre/shared, not a setting)
units90      = units sold at this branch in the trailing 90 days
leadDays     = supplier_product.lead_time_days ?? procurement.defaultLeadDays (default 14)
safetyDays   = procurement.safetyDays (default 7, branch-scopable)
cover        = ceilDiv(units90 * (leadDays + safetyDays), velocityDays)
maxLevel     = max(stored max_quantity, cover)
onOrder      = Σ(max(ordered − received, 0)) over open order lines
suggested    = max(clamp(maxLevel − on_hand − onOrder, 0, maxLevel), min_order_quantity)
```

Every term above is an integer. `ceilDiv` divides once at the end. When `leadDays` comes from the
default, the row says **"lead time assumed"**.

**Why:** D8 requires explainability and determinism; a float velocity would make two identical
screens disagree after re-rendering. The trailing window is fixed at 90 days rather than
configurable because a setting nobody changes is a setting nobody understands.

**Consequences:** `suggestedQuantity` is a pure function in
`packages/shared/src/replenishment.ts` with the full input struct in its signature, so the screen
can render every term it used. `whileNoSales` rows (units90 = 0) fall back to
`max_quantity − on_hand − onOrder`, and are labelled as such.

---

## P11-D13 — Catalogue cost is derived and read-only

**Decision:** `product.cost_price_minor` is written **only** by an inbound `RECEIPT` movement. It
is removed from `ProductCreateInput`/`ProductUpdateInput`'s accepted fields in
`products.validation.ts` and from the admin product form. The branch figure shown beside stock
remains `stock_level.avg_cost_minor`.

**Why:** D18. Two writable cost figures is how margin reporting loses trust. `sale_line` already
freezes `unit_cost_minor` at sale time, so historical margin is unaffected.

**Implementation seam:** the write happens inside `postMovements`
(`inventory.service.ts:113`) for `type === 'RECEIPT'` only, through
`inventory.repository.updateDerivedCost`. This is a deliberate cross-module **write** and is
documented in the plan: `products.service.ts:13` already imports `inventory.service`, so the
reverse import would create a module cycle. A transfer-in must **not** change catalogue cost,
and a test proves it.

**Consequences:** a product with stock has a cost that came from a receipt. A product with no
receipt keeps its seeded value until the first delivery. The UI labels it *"Latest receipt cost —
&lt;branch&gt;, &lt;date&gt;"* and never "cost".

---

## P11-D14 — The approval type enum ships with all seven types

**Decision:** `approval_type` is created with `PURCHASE_ORDER`, `PRODUCT_CREATE`,
`TRANSFER_REQUEST`, `STOCK_WRITE_OFF`, `PRICE_CHANGE`, `CREDIT_LIMIT_CHANGE`,
`SHIFT_VARIANCE_REVIEW`, `REFUND`. Phase 11 writes the first two.

**Why:** PostgreSQL cannot remove an enum value, and Phase 12 adds six of these plus refunds
from Phase 13. Writing the vocabulary once, now, means Phase 12 adds rows and screens instead of
a migration that must be split by hand (`P11-D16`).

**Consequences:** values nothing writes are inert. A comment in `approvals.schema.ts` names which
phase owns each.

---

## P11-D15 — Document numbers live in their own table, not in `setting`

**Decision:** a new `document_sequence` table:

```sql
document_sequence(id uuid pk, branch_id uuid not null, kind text not null,
                  period text not null,        -- 'YYYY-MM', Accra month
                  value integer not null,
                  unique (branch_id, kind, period))
```

`allocateDocumentNumber(kind, { branchId, branchCode, prefix }, executor)` locks the row
(`FOR UPDATE`), increments, and returns `{prefix}-{branchCode}-{YYYYMM}-{0000}`.

**Why:** `00-CONTEXT.md` D11 says "through the existing settings sequence machinery". That
machinery (`settings.service.ts:244-275`) is one static prefix plus one padded counter in a
single `setting` row, and cannot express *per branch, per month* without inventing dynamic
setting keys that `SETTING_DEFINITIONS` cannot validate. A three-column table with a unique
constraint is smaller than the workaround and is the shape the problem actually has. **This is
the one place a plan contradicts the locked context, and it does so deliberately.**

**Consequences:** `setting` keeps its existing nine global sequences untouched. PO, return and
credit-note prefixes remain settings (`procurement.orderPrefix` etc.) so the operator can change
them; only the counter moves. Phase 12 can reuse `kind` for transfer requests.

---

## P11-D16 — Enum values get their own migration file

**Decision:** `ALTER TYPE ... ADD VALUE 'SUPPLIER_RETURN'` for `stock_movement_type` and
`stock_movement_reference` goes in a migration containing **nothing else**.

**Why:** verified in this repository, not assumed. `drizzle-kit migrate` wraps each migration
file's statements in `BEGIN … COMMIT` (the `pg` connector's `transactionProxy`,
`node_modules/drizzle-kit/bin.cjs:78922-78940`), and PostgreSQL 12+ permits
`ALTER TYPE ... ADD VALUE` inside a transaction but **forbids referencing the new label in the
same transaction** (`ERROR: unsafe use of new value`). Migration `0007_common_next_avengers.sql`
got away with adding `'SALE'` because nothing in that file used it. A single generated migration
that adds the enum values *and* creates the return tables that default to them would fail.

**Consequences:** Plan 02 generates the migration, then splits it by hand into
`NNNN_enum_supplier_return.sql` (one statement pair) and `NNNN_procurement.sql` (everything
else), and the plan records the split. `drizzle-kit generate` must not be re-run after the split
for this phase.

---

## P11-D17 — Every procurement mutation is branch-scoped twice

**Decision:** the route checks `procurement.*`; the service then resolves the branch from the
session (`resolveBranchFilter` / `assertBranchAccess`) and re-reads the document with that scope.
A document id from another branch is a **403**, never a 404 that leaks existence — and never a
success. Approval decisions check authority **and** that the decider is not the requester.

**Why:** OWASP A01. The console hides what a user cannot do; hiding is not enforcing. `AGENTS.md`
rule 3 makes the server authoritative, and Phase 9's branch rule ("a manager cannot obtain
another branch's numbers by any parameter") is the same rule one layer down.

**Consequences:** Plan 11's walkthrough includes the IDOR legs: manager of branch A requests
branch B's order, receives against it, returns against it, and decides an approval for it —
four 403s. Each is asserted, not eyeballed.

---

## P11-D18 — Admin-raised orders are auto-approved

**Decision:** an order raised by an `ADMIN` is approved automatically regardless of value
(`approved_by = null`, audit action `purchase_order.auto_approved` with reason `ADMIN_REQUEST`).
Manager-raised orders use the threshold.

**Why:** `ROADMAP.md` Phase 12 criterion 3 requires that nobody approves their own request. With
one admin in a five-branch business, requiring a second admin to approve the owner's own purchase
is a deadlock dressed as a control. The admin is the top of the authority tree; there is nothing
above them to approve it. This keeps the no-self-approval rule absolute by removing the case
instead of carving an exception into it.

**Consequences:** `approval.decided_by` is always a different person from `approval.requested_by`,
testably. A future multi-admin business that wants a second signature sets the threshold to
`0` and changes this decision in Phase 12 — not here.

---

## P11-D19 — Receiving is allowed from `APPROVED` as well as `SENT`

**Decision:** `receive` accepts `APPROVED`, `SENT`, `PARTIALLY_RECEIVED`. It rejects `DRAFT`,
`PENDING_APPROVAL`, `REJECTED`, `RECEIVED`, `CLOSED`, `CANCELLED`.

**Why:** goods arrive before paperwork does. Refusing a delivery because nobody pressed "send"
would force a fake `SENT` timestamp, which then corrupts P11-D11's lead time. Receipt of an
approved order is a fact; record it.

**Consequences:** a receipt against an `APPROVED` order does not set `sent_at`. Lead-time
metrics exclude orders with no `sent_at` and say so.

---

## P11-D20 — Idempotency keys on every procurement POST

**Decision:** `POST /orders`, `POST /orders/:id/receive`, `POST /orders/:id/returns` and
`POST /procurement/products/submit` accept an `idempotencyKey` and store it with
`unique(branch_id, idempotency_key)`, mirroring `supplier_invoice` and `supplier_payment`.

**Why:** a console user double-clicks, a network retries, a proxy replays. The POS has this rule
because a duplicate sale is unthinkable; a duplicate purchase order is a duplicate commitment to
a supplier, which is the same class of harm and cheaper to prevent now than to reconcile later.

**Consequences:** a replay returns the original document with `200` and `replayed: true`, exactly
as `payables.service.ts:161-164` already does. A different payload under the same key is `409`.

---

## Carry-forwards this phase accepts

- **`stock_threshold` is not synced to the POS** (Phase 10, P10-D2). It stays that way:
  replenishment is console-only and the till's "out of stock now" tile is unchanged. Named in
  Plan 11's verification so nobody widens the sync streams "while they are there".
- **`averageBasketMinor` on a negative take** is Phase 13's question (P10-D3). Nothing here
  produces a negative take.
- **`supplier_product.is_preferred` partial unique is global per product** — P11-D10 records the
  consequence rather than fixing the schema.

## Carry-forwards this phase creates

- **Per-branch lead time** would need `supplier_product.branch_id` (or a new table). Recorded for
  the first time a manager asks why branch A and branch B share a lead time.
- **E-VAT on a purchase** is not in scope (GRA's E-VAT is a sales-side receipt in v1,
  `EVAT-01…03`). If a purchase-side obligation appears, it is Phase 14's adapter, not a column
  bolted onto `purchase_order`.
- **Approval expiry** (an order pending for 30 days) is not implemented; Phase 12's inbox owns
  age-based presentation and any auto-expiry decision.

---

## P11-D21 — Product submission is `procurement.create`, not `catalog.create`

**Decision (taken during Plan 01 execution, 2026-10-25):** `POST /api/products/submissions`
requires `procurement.create`. The manager is **not** granted `catalog.create` or
`catalog.update`.

**Why:** `00-CONTEXT.md` D12 grants `catalog.create` to the manager on the reasoning that the
service would raise a `PRODUCT_CREATE` request instead of inserting. In the code,
`catalog.create` also guards category, brand, and unit creation, and those have no approval flow —
granting it would let a manager create catalogue structure directly, which nobody decided.
`catalog.update` has the same problem in the other direction: the product update body carries
`basePriceMinor`, so granting it would hand price policy to the branch, contradicting MGR-02's
"archiving and price policy stay with the admin".

**Consequences:** the manager's product rights are exactly what MGR-02 asks for — submit a product,
which an admin creates. Descriptive editing of an approved product is not in Phase 11's scope; if
it is wanted later it needs a field-level guard on price and tax in `products.service.ts`, not a
permission grant. The six API tests that encoded the old matrix changed deliberately: the supplier
matrix now expects a manager's `POST /api/suppliers` to be **201** (MGR-01), and the catalogue and
product tests are unchanged because those permissions did not move.

---

## Where each decision was exercised

| Decision | Plan | Proof |
|---|---|---|
| P11-D1 return posts its credit note in one transaction | 07 | `procurement.service.postReturn`; walkthrough leg 18d–18g; `procurement.test.ts` "posting creates the credit note" |
| P11-D2 the threshold compares ex-tax goods value | 03/04 | `goodsValueMinor`; walkthrough legs 1c, 2a, 4a |
| P11-D3 reorder quantity → min order quantity | 02/08/10 | `stock_threshold` migration; `suggestReplenishment`; threshold dialog |
| P11-D4 `SENT` records a send and prints | 04/09 | `sendOrder`; print sheet; walkthrough leg 9 |
| P11-D5 a PO-filtered queue, not the unified inbox | 09 | order list status filter; approval panel on the detail page |
| P11-D6 auto-approved order writes no approval row | 03/04 | walkthrough legs 2b, 3b |
| P11-D7 approval creates the product as submitted | 03/09 | `PRODUCT_CREATE` handler; pending-submissions panel; walkthrough leg 25 |
| P11-D8 write-offs stay in Phase 12 | — | no write-off route exists in this phase |
| P11-D9 credit notes reduce owed, never the buckets | 07/11 | `sumSupplierOwed`; `suppliers.test.ts` credit-offset archive test; walkthrough leg 20 |
| P11-D10 preferred supplier and lead time are global | 08/10 | `selectReplenishmentRows`; unassigned group; "Choose supplier" action |
| P11-D11 performance per line with stated dates | 08/10 | `replenishment.test.ts` performance block; performance screen |
| P11-D12 integer velocity, rounded once | 01/08 | `replenishment.ts`; walkthrough leg 23 |
| P11-D13 catalogue cost derived and read-only | 05/09 | `updateDerivedCost`; product form; walkthrough leg 22 |
| P11-D14 approval types ship with all eight | 01/02 | `APPROVAL_TYPES`; `approval_type` enum |
| P11-D15 document numbers in their own table | 02 | `document_sequence`; walkthrough leg 1b |
| P11-D16 enum values get their own migration | 02 | `0007`-style split recorded in the migration file |
| P11-D17 every mutation is branch-scoped twice | 04–08 | walkthrough legs 26a–26e |
| P11-D18 admin-raised orders are auto-approved | 03/04 | walkthrough leg 3 |
| P11-D19 receiving is allowed from `APPROVED` | 05 | `canApplyOrderAction` matrix; `procurement.test.ts` |
| P11-D20 idempotency keys on every procurement POST | 04/05/07/08 | replay tests; walkthrough leg 24 |
| P11-D21 product submission uses `procurement.create` | 01/03 | permissions test; submission endpoint |
