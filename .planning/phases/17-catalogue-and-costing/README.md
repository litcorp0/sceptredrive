# Phase 17 — Catalogue Governance & Costing

**Goal:** a branch manager can keep their own catalogue tidy without creating duplicate
items, and a sale of a product that has never been received stops reporting a 100%
margin.

Two independent halves, both triggered by the same conversation on 2026-10-29:

| Half | Question it answers |
|---|---|
| **Catalogue** | "Can a manager create/edit a product for his branch without an admin?" |
| **Costing** | "There is no cost price at creation — how is profit calculated without a purchase?" |

## Scope

| # | Plan | Lane |
|---|---|---|
| 01 | Duplicate detection on create and on a manager's submission | api |
| 02 | Field-scoped editing: description direct, identity/commercial admin-only | shared + api + admin |
| 03 | Sale cost falls back to the product's last receipt cost | api |
| 04 | Margin is reported as unknown, not 100%, when no cost is known | api + admin |
| 05 | Opening stock can carry a cost and seed the weighted average | api + admin |

Explicitly **out of scope**: a second writable cost field, a user-typed "standard cost",
cost-variance postings for sales made before the first receipt (recorded as a later
follow-up), and branch-local product records.

## Execution shape

- 01 and 03 touch disjoint areas and may run in either order.
- 02 adds a permission to `packages/shared` and must land before its console work.
- 04 depends on 03 only in spirit: 03 gives a cost to more sales, 04 fixes what is
  shown when there is none. 04 does not read 03's code.
- 05 is the only schema-adjacent plan (validation + movement cost), and is last because
  it is the one that can change stock value.

## Verification

Every plan carries its own proof. The phase is done when:

1. A duplicate product name in the same category is refused with a code a manager can act
   on, both on the direct create path and on a submission.
2. A manager can edit a description and cannot edit a name, category, unit, tax category
   or base price — proven at the service, not only in the console.
3. A product received once at any branch sells with a cost at a branch that has never
   received it.
4. A sale with no cost anywhere reports margin `null`, and the overview exposes how much
   revenue is uncosted.
5. Opening stock with a unit cost seeds the branch average, and a negative adjustment
   never does.

## Links

- Decisions and rationale: `00-CONTEXT.md`
- Room research (official/industry sources) and repo facts: `01-RESEARCH.md`
- Project memory: `.planning/STATE.md`
