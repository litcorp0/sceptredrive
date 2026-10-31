# 18 — Summary

**Implemented:** 2026-10-31. The operator's two decisions (block with a manager PIN; default
threshold 5 with 0 as out-of-stock only) are in code.

## What shipped

| Plan | What it does now | Proof |
|---|---|---|
| 01 | Every active product appears at a branch, level or no level: `quantity 0`, `neverStocked`, and the stock list stops hiding it | new inventory API case |
| 02 | `inventory.defaultLowStockThreshold` (5, branch-scoped, manager-writable); effective threshold = product row → branch → global → 5; low is `1…n`, out is `≤ 0` | inventory API case, `stock-counts.test.ts` |
| 03 | Dashboard shows **Out of stock** and **Low stock** as separate figures; the stock list marks "Out of stock" and "never stocked" | console typecheck |
| 04 | Till is search-only; an out-of-stock hit is dimmed and needs a manager PIN (`inventory.adjust`); the sale still records `STOCK_OVERSELL` | desktop pricing tests |
| 05 | An approved product tells the admin it has no stock and links to Inventory | console typecheck |

Supporting changes: `stock-threshold.sql.ts` (one threshold rule, three readers);
`pos.outOfStockPolicy` (`BLOCK`/`WARN`/`ALLOW`, default `BLOCK`); the POS snapshot carries
`lowStockThreshold` and `outOfStockPolicy`; `stockBadge` takes the threshold;
`AttentionSummary.outOfStockCount`; `InventoryTotals.outOfStockCount` now counts the catalogue.

**AGENTS.md amended:** "Never block a sale" became "never *lose* a sale, and never sell silently
what the record says is not there" — the one refusal is an out-of-stock add, and it has an
authorised path that still records the conflict.

## Numbers

- API: inventory + analytics suites **68**, **full suite 869 / 63 files** green.
- desktop **618** (+2); `check-types` **7/7**; `lint` exit 0.
- No migration: two settings, query changes and one console marker.

## Deliberately not done

- **Pre-filtered dashboard links** (`?stock=out`): the tiles link to Inventory, which carries
  both filters in the query schema but the console does not read a URL parameter yet.
- **Prefilled "open stock now" dialog** from the approval: the notice links to Inventory
  instead of opening the adjust dialog with the product already chosen.
- **A branch assortment**: products are company-wide, so a branch's out-of-stock count is the
  whole catalogue minus what it holds. True, but noisy once the catalogue is large. An
  assortment (which products a branch is meant to carry) is the next step if that number
  becomes unhelpful.
- A computed reorder point (sales velocity × lead time). The flat default and per-product
  override are the starting point; the formula can replace the default later.

## Test-DB note

Inventory counts are now catalogue-wide per branch, so in the shared test database a suite sees
products created by other suites. The assertions added here scope themselves to their own
products; any future inventory assertion should do the same rather than assume an empty
catalogue.
