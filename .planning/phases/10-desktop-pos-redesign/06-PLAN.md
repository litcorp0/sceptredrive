---
phase: 10-desktop-pos-redesign
plan: 06
title: Sell module — catalog, cart, and the counter panels
lane: pos
depends_on: [03]
requirements: [UIX-09]
---

# Plan 06 — Sell module

> **Ordering.** In the serial order this runs after Plan 03. It shares no file with Plans 07 or 08,
> so it may run beside them under README wave 4's directory split — this plan owns
> `modules/{sell,cart,catalog,customers,credit,loyalty}`.

## Goal

The selling screen keeps every rule it has and gains a design system: the product name stops
being clipped, every control is a real target, and the panels that surround the cart read as one
product. The cart reducer, the discount service, the credit headroom, the loyalty quote, and the
pricing functions are **not touched** — this plan changes what the screen looks like, never what
it decides.

## Read first

- `00-CONTEXT.md` D8, D9, D12.
- `modules/sell/pages/sell-page.tsx` — the moved screen, in full, before touching it.
- `modules/cart/*`, `lib/cart/*` — reducer, totals, cart store. **Read-only in this plan.**
- `admin/src/modules/README.md` § "Rules" — the `ui/`-never-fetches rule.
- Phase 7's carry-forward in `STATE.md`: *"POS product tiles truncate names."*
- The 137 class names in this screen that use the raw Tailwind palette:
  `grep -rn "amber-\|emerald-\|sky-\|red-\|zinc-" desktop/src/renderer`.

## Tasks

### 1. Product card — the name stops being clipped

Today: a fixed `84px` card, two columns, `line-clamp-2` on the name and a `shrink-0` price
beside it, so a long name is cut and the price wins the fight for width
(`modules/catalog/components/product-grid.tsx:56-105`).

After:

- the card is a two-row grid: **name area** (`minmax(0,1fr)`, `line-clamp-3`) over a
  **foot row** (SKU left, tax + stock chips right), with the price pinned to the top-right of the
  name row but allowed to wrap below the name at ≤ 1280 px;
- card height grows with the layout (`120px` at 1024, `140px` at ≥ 1280) via a CSS variable the
  virtualiser reads, so `estimateSize` and the real row height cannot drift apart;
- the SKU keeps `truncate` but gains a `title` attribute;
- stock chips keep Phase 7's rule: the tint or dot carries the colour, the label stays
  `text-foreground`.

The fix is proven, not eyeballed: Plan 09's audit renders the longest product name in the demo
catalogue and asserts `scrollHeight <= clientHeight + 1` on the name element and that the price
is inside the card's box at 1024 × 768.

### 2. Cart

- Line rows: quantity stepper buttons at 44 × 44, remove and per-line discount at 44 × 44 (they
  are 24–28 px today), selected-row affordance visible without hover.
- `Clear` (`h-8` today) becomes a 44 px `Button variant="outline"`.
- The pay button stays `h-14` (56 px), `charcoal-on-orange`, and keeps `data-testid="pay-button"`
  and its `Pay GH₵ … F9` label — the E2E selects it by test id and reads the amount.
- Empty cart becomes `Empty` with copy that says what to do, not what is missing:
  *"Scan a barcode or search for a product to start the sale."* (unchanged wording).
- The restore/loading state becomes `Skeleton` rows rather than a paragraph.

### 3. The three panels

`CustomerPanel`, `LoyaltyPanel`, `CreditPanel` move to `Card`/`CardHeader`/`CardContent` with
`Empty`-style "no customer yet" states, and every action becomes a `Button`. The numbers they
display are unchanged and still come from `lib/customers/context.ts`.

### 4. Semantic colours replace the raw palette

The renderer uses ~100 raw Tailwind palette classes across 24 files. On the sell screen the
visible ones are the notice bar (`bg-amber-50 text-amber-900`), the error bar
(`border-destructive/40 bg-destructive/5`), and the stock/status chips.

Rules for this plan's files:

- a **notice** is `bg-warn/10` with a `--warn` dot and `text-foreground` text — the Phase 7
  contrast rule (a 10 % tint cannot carry a coloured 10 px label);
- an **error** is `bg-danger/10` with `text-foreground` and a `--danger` dot, plus
  `role="alert"`;
- an **informational** strip is `bg-muted` with `text-muted-foreground`;
- the notice wrapper becomes `role="status"` with `aria-live="polite"` so a scanned unknown
  barcode is announced, and its Dismiss control is 44 px.

Plans 07 and 08 finish the remaining screens; Plan 09's audit asserts the count of raw palette
classes in non-diagnostic renderer files is **zero**.

### 5. Shortcuts stay, and are visible

The existing map is kept exactly: `F2` search, `F4` customer, `F6` loyalty, `F8` discount, `F9`
pay, `↑`/`↓` select line, `+`/`-` quantity, `Escape` deselect. Nothing new is bound.

What changes: each control that has a key shows it (as the pay button already does), so the
keyboard is discoverable without documentation. No new hover-only affordance — every action is
reachable by pointer, Tab, and its key.

### 6. Density

The screen carries the counter scale from D9: 4 px spacing steps, 11–13 px captions, tabular
figures on every amount, and the same three-column skeleton at ≥ 1024 px
(`minmax(0,1fr) | minmax(360px,440px) | 280px`). Below 1024 px the third column moves under the
cart rather than disappearing — a 1024 × 768 counter is the smallest supported screen (D13) and
must not lose the credit panel.

## Verification

```bash
bun run --filter desktop test
bun run --filter desktop check-types
bun run lint
bun run modules:check:pos
grep -rn "amber-\|emerald-\|sky-\|red-\|zinc-" desktop/src/renderer/modules/sell \
  desktop/src/renderer/modules/cart desktop/src/renderer/modules/catalog \
  desktop/src/renderer/modules/customers desktop/src/renderer/modules/credit \
  desktop/src/renderer/modules/loyalty      # expect nothing
```

Expected: no test edited (the sell screen's behaviour is unchanged); the Electron E2E's selling
leg passes; at 1024 × 768 no card clips its name, the pay button is visible without scrolling,
and the credit panel is reachable.

## Commits

1. `feat(desktop): product cards sized by content, not by a fixed height`
2. `refactor(desktop): cart lines and controls on the primitives at 44px`
3. `refactor(desktop): customer, loyalty, and credit panels on Card and Button`
4. `refactor(desktop): semantic colour tokens replace the raw palette on sell`
5. `feat(desktop): visible shortcut hints and an announced notice bar`

## Done when

- The longest product name in the catalogue renders in full at 1024 × 768, with the price
  visible and the card height matching what the virtualiser assumed.
- Every control on the screen has a ≥ 44 × 44 px hit area; the pay button is 56 px and still
  labelled `Pay GH₵ …  F9`.
- Zero raw Tailwind palette classes remain in the six modules this plan touches.
- The cart reducer, totals, discount, credit, and loyalty files are untouched, and the desktop
  suite passes unedited.
