# Phase 19 — Go-Live Onboarding: Catalogue + Opening Stock

**Goal:** a branch that is already trading can load its existing products and counted stock
in one controlled, valued, audited operation — without a fake supplier receipt — and the
everyday “manager proposes, admin approves” flow can carry the opening stock with it.

## Why

The live branch is already selling and already owns stock. Products are created at quantity
0, and the only door the operator could find was a goods receipt. The repository already
lets a positive `FOUND`/`CORRECTION` adjustment carry a unit cost (17-05), but it is one
product per dialog, has no document, no sign-off and no go-live report.

## Plans

| # | Plan | Lanes |
|---|---|---|
| 01 | Shared contract, permissions, schema and migration | shared + api |
| 02 | Opening-stock API: preview, draft, post, audit | api |
| 03 | Proposal opening stock and the product-creation seam | api |
| 04 | Console: go-live wizard, proposal fields, prefilled stock action | admin |
| 05 | Reports, movement filter and the live-branch runbook | api + admin + docs |
| 06 | Verification, evidence and project-memory update | verify + controller |

## The one combined document

A row carries the catalogue fields and the counted quantity:

```text
sku? | barcode? | name | category | unit | brand? | price | cost | quantity
```

- Matching order: explicit product → SKU → barcode → exact trimmed name + category.
- No match → the row is a **new product**, created by the admin at post time.
- Existing products are stocked, never renamed, and their prices are not changed.
- The line stores the **counted quantity**; posting computes the delta against on-hand.
- Opening is additive only. A shelf lower than the system is a count/write-off, not an
  opening.
- Cost is required for quantity > 0; zero is allowed only as an explicit uncosted line.

## Decisions

See `00-CONTEXT.md` (D1–D18). The seven operator answers are D1–D7.

## Verification

The phase is done when:

1. A 300-line file (new, existing, zero-cost, duplicate, bad barcode, unknown category) is
   previewed with the right classification and row errors, and nothing is written.
2. A clean draft posts as one transaction: new products exist, `OPENING` movements exist,
   levels and averages are correct, and the audit names the actor and the document.
3. Posting twice, or retrying the same idempotency key, does not double the stock.
4. A manager cannot post, and cannot draft at another branch; the admin can.
5. A manager's product proposal with opening quantity/cost creates the product and stocks
   it on approval; a rejection posts nothing.
6. A sale after the opening uses the seeded branch average; the pre-opening sales remain
   uncosted and are reported as such.
7. The stock report and movement filter show `OPENING`; every gate is green.

## Links

- Decisions and rationale: `00-CONTEXT.md`
- Sources and repository facts: `01-RESEARCH.md`
- The live-branch sequence: `RUNBOOK.md`
- Verification: `19-VERIFICATION.md`
- Project memory: `.planning/STATE.md`
