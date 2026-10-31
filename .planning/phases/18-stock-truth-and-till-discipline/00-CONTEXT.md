# 18 — Context and decisions

## D1 — Reads start from the product, not from the level

An inventory read for a branch is "every active product × this branch, left-joined to its
level". `null` on the join is **zero on hand**, flagged `neverStocked` so the console can tell
"we have none" from "we have never counted". Counting products was the wrong unit; the
catalogue is.

For a multi-branch read (an admin with no branch chosen) the same rule applies by joining every
active branch, so a product that is never stocked at Tema still appears in Tema's row.

## D2 — One threshold rule, three readers

Effective threshold = `coalesce(stock_threshold.threshold, branch setting, global setting, 5)`.
It is expressed once as a SQL fragment (`stock-threshold.sql.ts`) and used by the stock list,
the analytics inventory totals and the attention counts — the same reason the repo keeps one
`LOW_STOCK_SQL` today: two definitions is how a badge and a report start disagreeing.

`inventory.defaultLowStockThreshold` is branch-scoped and manager-writable: a fast mover needs a
higher number than a slow one, and the manager is the person who knows which is which.

## D3 — Out of stock and low stock are disjoint

`quantity ≤ 0` → out of stock. `1 ≤ quantity ≤ threshold` → low. A single bucket that covers
both is how an empty shelf hides behind a reassuring "5 low". They are counted separately and
shown as separate figures everywhere.

## D4 — The till blocks, and a manager may authorise

`pos.outOfStockPolicy` = `BLOCK` (default) | `WARN` | `ALLOW`, branch-scoped.
Under `BLOCK` the card is dimmed, `aria-disabled`, and its click does nothing; an out-of-stock
hit in search results offers **Manager override**, which reuses the existing PIN dialog
(`inventory.adjust`) and then adds the line.

The sale is unchanged: it uploads, the server applies it and raises `STOCK_OVERSELL`. So the
rule becomes "never *silently* sell what the record says is not there", which is the intent —
not "never sell".

This is a deliberate change to the AGENTS invariant "never block a sale at the till". The line
is amended with this phase rather than contradicted quietly.

## D5 — Availability is local

The till already computes available = synced `quantity_on_hand` + unacked `local_stock_delta`.
Blocking uses that number, so it works offline and accounts for sales this terminal has not
uploaded yet.

## D6 — A new product still has no stock

Approving a `PRODUCT_CREATE` creates a product, not stock. After approval the console offers
"Receive or open stock now", prefilled with that product, so the item cannot sit invisible and
unsellable for want of a follow-up screen.
