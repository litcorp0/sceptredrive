# Phase 10 — Decisions taken during planning (2026-10-25)

These refine `00-CONTEXT.md`. Where a refinement contradicts the locked context, the
refinement wins and the context is amended in Plan 10's state update.

Four of them change **what the home screen shows**, so read this before Plan 04.

---

## P10-D1 — The home screen is this terminal's day, and says so

**Decision (operator, 2026-10-25):** every figure on `#home` is scoped to this terminal and
this Accra day. The heading reads **"This terminal today"** with the terminal and branch codes
beside it. No figure is ever presented as branch or company takings.

**Why:** `sale`, `sale_line`, `sale_tender`, and `cash_movement` are **local-only** tables
(`desktop/src/renderer/lib/powersync/schema.ts:183-297`, all `localOnly: true`), and
`powersync/sync-config.yaml` deliberately excludes sales: *"The device gets the catalogue,
stock, customers, and credit/loyalty balances — never the ledgers."* The terminal therefore
holds exactly the sales it wrote itself. A heading of "Today's take" would be read at a
counter as the branch's takings, which it is not.

**Consequences:**
- There is no API call on the home screen (D4 stands), so the figure is correct with the
  network unplugged.
- The card labels must carry the scope even when the header is scrolled off: each figure's
  caption reads "today on this terminal" rather than "today".
- Branch takings remain the console's job (Phase 9) and Phase 14's POS oversight.

---

## P10-D2 — The needs-attention strip reports *out of stock now*, not low stock

**Decision (operator, 2026-10-25):** replace D5's "low-stock items" with **"out of stock
now"**: the count of products at this branch whose `stock_level.quantity_on_hand <= 0`.

**Why:** the terminal has no thresholds. `stock_threshold` is a server table and is **not** in
any sync stream (`powersync/sync-config.yaml` syncs `product`, `barcode`, `product_price`,
`stock_level`, `customer`, `credit_profile`, `loyalty_account`, `loyalty_lot` — and nothing
else). D5's low-stock item is therefore impossible offline without widening what the device
stores. Out-of-stock is already local, and it is the condition that actually interrupts a sale
at a counter.

**Consequences:**
- The strip's four items are: unprinted receipts, open sync conflicts, uploads waiting, out of
  stock now.
- A part the branch has **never** stocked has no `stock_level` row and does not appear. That
  is a known gap and it is Phase 11's job (replenishment already has to answer "what should we
  order that we do not stock"). The strip's caption says "products at this branch", not "all
  products".
- No change to `sync-config.yaml` in this phase.

---

## P10-D3 — Average basket is one shared function

**Decision (operator, 2026-10-25):** `averageBasketMinor(takeMinor, salesCount)` lands in
`@sceptre/shared` and both the analytics service and the POS call it.

```
averageBasketMinor = salesCount === 0 ? 0 : Math.round(takeMinor / salesCount)
```

**Why:** `api/src/modules/analytics/analytics.service.ts:256-261` already computes exactly
this. A cashier reading "average basket" on the till and a manager reading it on the dashboard
must not be able to disagree because one rounded differently. Two implementations of a
rounding rule is how that happens.

**Consequences:**
- The API call site changes: `analytics.service.ts` deletes its inline expression in favour of
  the helper. Behaviour is byte-identical for the existing `analytics.test.ts:463` assertion
  (`15_000`).
- This is the **only** API file touched in this phase, and it is a controller follow-up in
  Plan 01, not a lane task.

---

## P10-D4 — The counter home shows no tender mix

**Decision:** the home screen shows take, expected cash in the drawer, credit given, items
sold, average basket, hourly shape, top five, and the attention strip. It does **not** show a
cash/electronic/credit mix.

**Why:** P9-D2 proved that summing `sale_tender` overstates cash, because a `CASH` tender row
stores what the customer handed over, not what the till kept (`change_minor` is the
difference). On the console the mix is derived as `take − electronic − credit`. On the till
that derivation would be a second implementation of a rule the server already owns, for a
figure a cashier does not act on. Expected cash in the drawer is the number that matters and
it comes from the existing shift formula.

**Consequences:** Phase 13 revisits this when electronic tenders exist and the till has a real
reason to show the split.

---

## P10-D5 — Day figures and drawer figures are different windows, and are labelled as such

**Decision:** "Take today" is a **day** window (`occurred_at >= start AND < next start`, all
shifts); "expected in the drawer" is the **open shift** window, from the existing
`selectShiftCashTotals` + `computeExpectedCash`
(`desktop/src/renderer/lib/shift/shift-repository.ts:235`,
`desktop/src/renderer/lib/shift/shift-service.ts:54`).

**Why:** after a close and a reopen on the same day, the two legitimately differ — the day
includes both shifts, the drawer holds only the current one. If they shared a window, one of
them would be wrong; if they shared a label, a cashier would think the till was short.

**Consequences:** the drawer card is titled "Expected in the drawer (this shift)" and carries
the shift number. It is never labelled "cash today".

---

## P10-D6 — `#home` is a top-level hash route; the guard ladder does not move

**Decision:** `#home` sits beside `#shift` and `#pos` in `main.tsx` and mounts the **same**
guard component as `#pos`. `PosBoot` resolves `screen = route.path === 'home' ? 'home' :
(route.segments[1] ?? 'sell')`. The five gates (no DB → no staff → no config → no shift →
settings permission) stay exactly where they are, in that order.

**Landing:** the two lines that are `routes/login.tsx:27` and `routes/shift.tsx:193` **today**
navigate to `#home` instead of `#shift` / `#pos`. Plan 02 makes those route files thin re-exports,
so in practice the edit lands in `modules/auth/pages/login-page.tsx` and
`modules/shift/pages/shift-page.tsx`. Home requires an open shift, so a cashier who signs in with
no shift is sent on to `#shift` by the existing gate — one hop, and the reason is the same as
today.

**Why:** `#pos` already means "selling" throughout the codebase and in the E2E
(`navigate('pos')` from tender, receipt, sales, sync, and the header). Redefining it as home
would silently change the meaning of nine call sites. A separate route costs one branch in
`main.tsx` and leaves every existing meaning intact.

**Consequences:** the Electron E2E, the offline walkthrough, and the packaged shell smoke all
assert the landing screen and **must be updated in Plan 05** — deliberately, recorded as a
deviation, never deleted or loosened.

---

## P10-D7 — F2 keeps one meaning: "find an item"

**Decision:** on the sell screen F2 focuses the search field (unchanged,
`routes/_pos/sell.tsx:215`). On the home screen F2 navigates to the sell screen and focuses
that same field.

**Why:** `00-CONTEXT.md` D5 offers "F2 or the primary button" for *Start selling*. Making F2
mean "go to the sell screen" on one screen and "focus search" on the next teaches a cashier a
key that changes meaning under their hands. One meaning — *find an item* — is learned once and
is correct in both places: on home it takes you to the only place you can find one.

**Implementation:** a one-shot intent, `lib/ui-intent.ts` (`requestFocus('search')` /
`consumeFocus('search')`), a module-level variable that survives a hash navigation in the same
page load. No query string, no storage, no state library.

**Consequences:** the home screen's primary button is labelled **Start selling** and is the
only ≥ 56 px control on the screen.

---

## P10-D8 — Verification is light-mode only; the POS has no dark theme

**Decision:** D13's "screenshots per screen in both themes" is amended. The counter audit runs
**light** at three widths and under `prefers-reduced-motion: reduce`.

**Why:** the desktop renderer never applies `.dark`. The only occurrence of the class in
`desktop/src` is `components/ui/chart.tsx:9`, the registry's `THEMES` constant, which nothing
on the POS uses. There is no theme toggle and `app-header.tsx:16-20` records why: *"The POS has
no theme toggle, so the light-mode semantic tokens are too dark to read as text here."* A
"both themes" matrix would assert a state the product cannot enter.

**Consequences:** `@sceptre/brand` keeps its dark block (the debug/shell surface inherits it
and the token gate still checks it). If a dark till is ever wanted it is its own phase, with
its own contrast pass — not a side effect of this one.

---

## P10-D9 — `components/layout` and `components/common` stay global

**Decision:** `app-header.tsx`, `sync-badge.tsx`, and the retuned chrome live in
`desktop/src/renderer/components/layout/`. Anything used by more than one module lives in
`components/common/` — starting with `manager-override-dialog.tsx` (imported by both
`routes/_pos/sell.tsx` and `routes/_pos/tender.tsx` today).

**Why:** this is exactly Phase 8's resolution for `supplier-combobox` and `product-picker`
(`admin/src/modules/README.md`): a shared component that lived inside one module forces that
module's barrel to re-export a component into a cycle. Phase 8's gate already encodes the
allowlist as `GLOBAL_COMPONENTS = {ui, common, layout}` (`scripts/check-modules.mjs`), so the
desktop gate inherits the same three names and no new concept.

---

## P10-D10 — In a desktop module, `api/` means the local data source

**Decision:** the seven folders keep their names, and their meaning is translated for a client
that has no server calls:

| Folder | Means on the terminal |
|---|---|
| `api/` | PowerSync query definitions, SQL constants, and row types |
| `hooks/` | `useQuery` wrappers over those definitions |
| `utils/` | pure functions, unit-tested with vitest |
| `ui/` | presentational only — never queries |
| `pages/` | composition roots, one per hash route |

**Why:** D1 mirrors the admin deliberately. Inventing a different shape because the data
source is SQLite would break the one mental model that covers both clients — which is the
whole point of D1.

**Consequences:** `ui/` may not import `@powersync/react`. That rule is reviewable and the
gate checks the import where it can.

---

## P10-D11 — One owning component per module; panels own their dialogs

**Decision:** a cross-module consumer imports **one** component from a module barrel. The
`customers` module exports `CustomerPanel`, which internally owns `customer-dialog` and
`customer-create-dialog`. `loyalty` exports `LoyaltyPanel`, which owns `loyalty-redeem-dialog`.
`credit` exports `CreditPanel`. `catalog` exports `CatalogBrowser` (search + grid + scan
listener).

**Why:** today `routes/_pos/sell.tsx` imports five dialogs and five panels directly (541
lines). If each panel exported its dialog too, the `sell` module would depend on five sibling
barrels' internals, and the first time `customers` needs something from `sell` the imports
become a cycle. `admin` already hit this twice in Phase 8 and recorded it.

**Consequences:** `sell/pages/sell-page.tsx` ends up importing from `@/modules/catalog`,
`@/modules/cart`, `@/modules/customers`, `@/modules/credit`, `@/modules/loyalty`, and
`@/components/common` — six barrels, no internals.

---

## P10-D12 — Watch queries are cheap, throttled, and indexed

**Decision:** every home query is day-bounded, parameterised on `terminal_id`, throttled at
250 ms, and covered by an index declared in the schema definition. No home query scans
`sale` without a window. The database opens with a prepared-statement cache.

**Why, from the PowerSync performance guidance:** *"For auto-updating watched queries on
frequently-changed tables, queries might run very often. Watched queries should typically be
cheap to run… consider increasing their throttle."* and *"When filtering on other columns of
large tables, make sure these columns are covered by indexes declared in your app's schema."*
A POS writes a sale, a sale line, and a tender inside one transaction; without a throttle that
re-runs seven aggregates three times in a burst.

**Consequences:**
- `sale` gains `sale_terminal_occurred: ['terminal_id', 'occurred_at']` (Plan 01). Today it has
  `sale_shift` and `sale_occurred` only (`schema.ts:242`).
- `WASQLiteOpenFactory` gains `preparedStatementsCache: 64`
  (`database.ts:53-63`); confirmed present in `@powersync/web`'s `ResolvedWebSQLOpenOptions`.
- The `sale` table on a busy terminal grows without bound. Every home query carries the day
  window in SQL, and Plan 04 proves the plan uses the index.

---

## P10-D13 — The Accra day rolls over while the app is open

**Decision:** `useAccraDay()` returns the current Accra ISO day and re-renders at the next
boundary.

**Why:** a till is left open across midnight. Without a boundary timer, a cashier opening the
next morning reads yesterday's take as today's — on a screen that only claims to be today.
Africa/Accra is UTC+0 with no DST (`packages/shared/src/dates.ts:1-8`), so the boundary is an
exact UTC midnight and no timezone library is involved.

**Implementation:** a `setTimeout` to the next UTC midnight (+2 s guard), re-armed on each
firing, cleared on unmount; the visible day string comes from the existing `accraIsoDay` /
`accraDay` helpers. Unit-testable as a pure `msUntilNextAccraDay(now)` function.

---

## P10-D14 — Phase 9's chart rule applies at counter distance

**Decision:** the hourly chart carries the same three things the console's charts carry —
`accessibilityLayer` (default true in Recharts 3.x; never set it false), a one-sentence summary
that states what it means without a hover, and a data-table alternative.

**Why:** P9-D3 and the Phase 9 research are explicit that the accessibility layer supplies
ARIA and keyboard navigation but **not** descriptions, legends, or tables. A cashier wearing
gloves at 1024 px is a harder reader than a manager at a desk, not an easier one.

**Consequences:** the table alternative is rendered as a compact, always-present 24-row grid
behind a `<details>` element (a counter has no room for a toggle-heavy pattern), and the
summary sentence names the peak hour. The chart sits on `bg-card`, never the canvas — P9-D3's
3:1 bound is measured against the surface.

---

## P10-D15 — A local schema change must be proven on a database that already has sales

**Decision:** Plan 01's index change is proven twice: on a fresh database, and on a copy of a
database that already holds sales, lines, tenders, an open shift, and pending outbox rows.

**Why:** the local database is encrypted at rest and lives in Electron's `userData`; there is
no way to rebuild it on a live terminal without losing pending sales. PowerSync applies local
schema migrations on init, and the one thing this phase must not do is discover a migration
fault on a till holding an unuploaded day of trading.

**Consequences:** the test opens the previous schema, writes fixtures, closes, reopens with the
new schema, and asserts every row still reads. It runs as a vitest case against the same
`WASQLiteOpenFactory` the renderer uses, not a mock.
