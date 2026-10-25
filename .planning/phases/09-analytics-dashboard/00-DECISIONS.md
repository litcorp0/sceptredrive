# Phase 9 — Decisions taken during planning (2026-10-25)

These refine `00-CONTEXT.md`. Where a refinement contradicts the locked context, the
refinement wins and the context is amended in Plan 08's state update.

## P9-D1 — Gross profit is ex-tax

**Decision (operator, 2026-10-25):** gross profit is the tax-exclusive base minus the frozen
cost snapshot.

```
revenueBaseMinor = Σ sale_line.base_minor
costMinor        = Σ (sale_line.unit_cost_minor * sale_line.quantity)
grossProfitMinor = revenueBaseMinor - costMinor
marginBp         = ratioBp(grossProfitMinor, revenueBaseMinor)
```

**Why:** `00-CONTEXT.md` says "gross profit = Σ (net − cost)", but in `INCLUSIVE` tax mode
(the default, `pricing.taxMode`) `line.net_minor` still contains VAT/NHIL/GETFund
(`packages/shared/src/pos.ts:193-208`: `taxableMinor = netAfterSaleLine - loyaltyShare`, and
`base_minor` is the ex-tax figure from `taxBreakdown`). Using `net_minor` would inflate
margin by up to 20% and vary with the tax rate.

**Consequences:**
- VAT/NHIL/GETFund are never revenue in any read model.
- `revenueBaseMinor` is reported separately from `takeMinor` (what the customer paid).
- The invariant test is `Σ base_minor = Σ(total_minor − tax_total_minor)` for sales where
  header and lines agree; where they do not, `driftMinor` is surfaced (see P9-D5).

## P9-D2 — Tender mix is derived, never summed from `sale_tender`

**Decision:** for each sale,

```
electronicMinor = Σ sale_tender.amount_minor WHERE method <> 'CASH'
creditMinor     = sale.credit_amount_minor
cashMinor       = sale.total_minor - electronicMinor - creditMinor   (clamped at 0)
```

and the Till Line asserts `cash + electronic + credit = take`.

**Why:** `sale.tender_total_minor` is cash **tendered** plus credit, and
`change = tender_total − total`. A GHS 225 sale paid with a GHS 300 note stores
`CASH 30000`; summing tender rows would overstate the till by GHS 75 and the mix would not
reconcile to the take.

**Future-proofing:** Phase 13 adds `MOMO`, `CARD`, and `BANK` to `sale_tender_method`. The
read model groups whatever non-CASH methods exist, so no rewrite is needed — only new
labels. A guard test asserts the three components sum to the take for the demo dataset.

## P9-D3 — Chart ramp extends to seven steps

**Decision (operator, 2026-10-25):** add `--chart-6` and `--chart-7` to
`packages/brand/src/tokens.css` in both themes, map them in `@theme inline`, and raise the
token gate from five to seven.

Light (measured against `--surface` `#ffffff`):

| Token | Value | Contrast | Note |
|---|---|---|---|
| `--chart-1` | `#f26a1b` | 3.06:1 | brand |
| `--chart-2` | `#1b1f23` | 16.58:1 | ink |
| `--chart-3` | `#8a939f` | 3.11:1 | grey-blue |
| `--chart-4` | `#c97b3d` | 3.29:1 | burnt orange |
| `--chart-5` | `#2f6f6a` | 5.83:1 | teal |
| `--chart-6` | `#5b6ea8` | 4.95:1 | slate blue |
| `--chart-7` | `#8c5a8f` | 5.28:1 | plum |

Dark (`#22272c` surface): `#f26a1b` 4.91, `#f6f6f4` 13.92, `#9aa3ae` 5.90, `#d98b4b` 5.55,
`#4e9a94` 4.57, `#8fa3d8` 6.02, `#c08fc4` 5.71.

The new steps clear 4.5:1 so future charts have headroom; `--chart-1` and `--chart-3` only
just clear 3:1 on white, which is why **chart panels sit on `bg-card` (`--surface`), never
directly on the canvas** — 1.4.11 is measured against the surface a graphic is drawn on.
Charts must never rely on colour alone: legend, direct labels, and the data-table
alternative carry the meaning.

## P9-D4 — Branch in the URL wins on analytics and dashboard

**Decision (operator, 2026-10-25):**

- `?branchId=` is authoritative on `/` and `/analytics` when present.
- Absent, the page falls back to `useBranch().activeBranchId` (localStorage/provider).
- The header `BranchSwitcher` writes both the provider **and** the current search param
  when the current route is `/` or `/analytics`, so a copied URL shows what the sender saw.
- A manager's page never sends `search.branchId`: the client drops it and uses
  `session.user.branchId`. The server still returns **403** for a foreign branch, so a
  hand-edited URL cannot see another branch's numbers.
- An admin choosing "All branches" removes the param (via `stripSearchParams`), which keeps
  URLs short and matches the existing `null = all branches` semantics.

## P9-D5 — Drift between sale header and lines is surfaced, not hidden

`assessSaleTotals` stores the **charged** header totals when a sale is internally consistent
but differs from the server recomputation (`TOTAL_MISMATCH`, `pos.service.ts:905-950`).
Header tax and line tax can therefore disagree for those sales.

**Decision:** headline totals (take, tax split, tender mix) come from `sale`; product,
category, cost, and margin figures come from `sale_line`; each tax and revenue response
carries `driftMinor = headerFigure − lineFigure`. The invariants test asserts drift is zero
for the demo month (which contains no `TOTAL_MISMATCH`) and non-zero with a deliberate
fixture, so the field is proven to work rather than assumed always-zero.

## P9-D6 — One read-only snapshot per request

Every analytics endpoint runs its queries inside

```ts
db.transaction(fn, { isolationLevel: 'repeatable read', accessMode: 'read only' })
```

after `SET LOCAL statement_timeout = '3000ms'`. Verified against
`node_modules/drizzle-orm/pg-core/session.d.ts:32-33`.

**Why:** parallel autocommit queries can observe different snapshots, which would let a
KPI tile and the series under it disagree by a sale. A single read-only snapshot makes
"a number on screen is traceable to one endpoint field" mechanically true, and `read only`
means a bug in the read model cannot write.

## P9-D7 — Buckets are calendar days in Accra, sent as `YYYY-MM-DD`

Africa/Accra is UTC+0 with no DST, so the server buckets with
`date_trunc('day' | 'week' | 'month', occurred_at, 'UTC')` (PostgreSQL 17's timezone-aware
form, confirmed in the 17 docs) and returns `bucketStart` as `YYYY-MM-DD`.

The client formats that string with the existing `formatBucket` from `@sceptre/shared`
(`date-fns.parseISO` treats a date-only string as local midnight, so "24 Oct" is 24 Oct in
every browser timezone). Series are gap-filled server-side with `generate_series` so a day
with no sales is a zero, not a missing point.

## P9-D8 — CSV escaping follows the 2026 OWASP guidance

Beyond `=` `+` `-` `@` TAB CR, the danger set includes **LF** and the full-width forms
`＝ ＋ － ＠`. Cells are quoted, quotes doubled, dangerous cells prefixed with `'`, rows
end CRLF, and the file starts with a UTF-8 BOM so Excel reads cedis correctly.

Excel can strip escapes on save/reopen; the tab-inside-quoted-field alternative is recorded
in the helper's doc comment as the known trade-off (it pollutes programmatic consumers), and
we do not apply it. Exports are generated server-side only, from the same service function
as the JSON view, with the same permission and branch scope.

## P9-D9 — No caching, no materialised view, no migration

Per D13. `staleTime: 60_000` on the client only (a display convenience, never a
server-side cache). Each endpoint is rate-limited in memory (120 requests/minute per user;
20/minute for exports) using the existing `rateLimit` middleware. If a query exceeds 300 ms
on the demo dataset it is rewritten; the perf evidence script records p50/p95.

## P9-D10 — Read-model boundary for cross-module data

An analytics read model spans domains by definition. The boundary rule:

- `analytics.repository.ts` may import sibling **`*.schema.ts`** files (Drizzle tables) to
  aggregate. This is the same documented cross-module data edge Phase 8 accepted for
  `inventory ↔ payables` and `suppliers ↔ payables`.
- It may **not** import sibling repositories, and it must not re-implement a business rule
  that an owning service already owns. Where a rule exists — low stock, loyalty liability
  and expiring points, credit over-limit — the analytics service calls the owning service
  or the owning service gains a narrow count/summary function.
- The exception is recorded in the header comment of `analytics.repository.ts` and in
  `00-DECISIONS.md`, so the next module author does not copy it as a general licence.

## P9-D11 — Placeholder for refunds

`00-CONTEXT.md` asks for `net = sales − refunds` now with refunds at zero until Phase 13.
The response carries `refundsMinor: 0` and `refundCount: 0` **marked reserved in the type
comment**, and no screen renders a "refunds" figure yet. When Phase 13 lands, the fields
populate and the UI gains its line; no consumer changes shape.
