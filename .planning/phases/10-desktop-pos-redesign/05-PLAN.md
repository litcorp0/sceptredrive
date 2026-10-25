---
phase: 10-desktop-pos-redesign
plan: 05
title: Home screen, #home routing, and dev-charts retirement
lane: pos + controller
depends_on: [03, 04]
requirements: [UIX-09]
---

# Plan 05 — Home screen, `#home`, and `dev-charts` retirement

## Goal

The till opens on a screen that answers "how is today going?" for this terminal, and selling is
one action away — including with the network unplugged. The guard ladder does not move; a
closed shift still sends the cashier to `#shift`.

This is the only plan in the phase that adds behaviour. Everything else moves or retunes.

## Read first

- `00-DECISIONS.md` P10-D1, P10-D4, P10-D5, P10-D6, P10-D7, P10-D8, P10-D14.
- `modules/home/api/queries.ts` and `utils/` (Plan 04) — the only data source.
- `routes/_pos/app.tsx:50-148` — the five gates and the `needsShift` rule.
- `components/layout/app-header.tsx` — the chrome Plan 03 left in place; this plan adds the one
  affordance in it.
- `admin/src/modules/dashboard/components/till-line.tsx` — the console's version of the same
  idea; the POS one is smaller and denser, not a copy.
- `phases/09-analytics-dashboard/01-RESEARCH.md` — `accessibilityLayer`, `min-h` on
  `ChartContainer`, recharts#7905.

## The screen

```
┌──────────────────────────────────────────────────────────────────────┐
│ POS chrome: branch · terminal · shift             sync · cashier · ⋯ │
├──────────────────────────────────────────────────────────────────────┤
│ This terminal today · Sat 25 Oct 2026            [ Start selling  ]  │
│                                                                      │
│  GH₵ 4,215.00                                                        │
│  37 sales · 94 items · GH₵ 113.92 average basket                     │
│                                                                      │
│  ┌────────────────┐ ┌────────────────┐ ┌────────────────┐            │
│  │ Expected in    │ │ Credit given   │ │ Tax included   │            │
│  │ the drawer     │ │ today          │ │ today          │            │
│  │ (this shift)   │ │                │ │                │            │
│  └────────────────┘ └────────────────┘ └────────────────┘            │
│                                                                      │
│  ┌───────────────────────────────┐ ┌───────────────────────────────┐ │
│  │ Sales by hour  (24 bars)      │ │ Top five today                │ │
│  │                               │ │ 1. …  ×6  GH₵ 1,240.00        │ │
│  └───────────────────────────────┘ └───────────────────────────────┘ │
│                                                                      │
│  Needs attention:  2 to print · 1 upload waiting · 4 out of stock    │
└──────────────────────────────────────────────────────────────────────┘
```

- **The take is the screen.** `font-display`, `tabular-nums`, five times the body size, with the
  three sub-figures beneath in one muted line. This is the console's Till Line at counter
  distance: same idea, fewer words, bigger number.
- **The current hour is the only orange bar.** Every other hour is `--chart-3`; the hour the
  clock is in is `--chart-1`. The chart therefore answers "where are we right now" without a
  legend, without a hover, and without a second colour decision. The summary sentence beneath
  names the peak: *"Busiest at 11:00 with GH₵ 812.00."*
- **Two columns at ≥ 1280 px, stacked at 1024 px.** The primary action sits in the heading row,
  so it is visible in both layouts and never scrolls away.
- **Tax is shown, not hidden.** A cashier who counts the drawer needs to know the take includes
  GHS X of tax that is not the shop's money.

## Tasks

### 1. `modules/home/pages/home-page.tsx` and its parts

```
modules/home/components/
  take-figure.tsx        the dominant number and its sub-line
  drawer-tile.tsx        expected cash for the open shift, or "No open shift"
  stat-tiles.tsx         credit given, tax included
  hour-chart.tsx         Recharts, 24 bars, current hour in --chart-1
  top-sellers.tsx        ordered list, or Empty
  attention-strip.tsx    four items, zero-count hidden
```

`hour-chart.tsx` rules (P10-D14):

- `ChartContainer` with an explicit height (`h-40` at 1024, `h-48` above) — a missing height is
  recharts#6716 waiting to happen;
- `accessibilityLayer` left at its 3.x default (never set false), and **no `role="img"`** on the
  container — Phase 9 measured that it mutes the Recharts accessibility layer;
- one `Bar`, `fill="var(--color-take)"`, no animation under `prefers-reduced-motion`;
- a `<figcaption>`-style summary sentence and a `<details>` containing a 24-row table with an
  hour and an amount per row;
- the panel sits on `bg-card` (P9-D3 measures 3:1 against the surface, not the canvas).

`top-sellers.tsx` and `attention-strip.tsx` use `Empty` for their empty states rather than a
dashed box (Plan 03).

### 2. Routing (P10-D6, P10-D7)

- `main.tsx`: `route.path === 'home'` mounts the same `PosProvider` + `PosRoutes` as `#pos`.
- `routes/_pos/app.tsx`: `const screen = route.path === 'home' ? 'home' : (route.segments[1] ?? 'sell')`,
  then render `HomePage` for `home`. The gate order is untouched: a cashier with no open shift
  is still sent to `#shift`.
- **The landing lives in the module pages, not the route files.** Plan 02 made
  `routes/login.tsx` and `routes/shift.tsx` thin re-exports, so the two lines that used to be
  `routes/login.tsx:27` and `routes/shift.tsx:193` now sit in
  `modules/auth/pages/login-page.tsx` and `modules/shift/pages/shift-page.tsx`:
  `'#shift'` → `'#home'`, and `'#pos'` → `'#home'` respectively. Editing the route files will
  silently do nothing.
- `lib/ui-intent.ts`: `requestFocus('search')` / `consumeFocus('search')`. Home's F2 and
  *Start selling* both `navigate('pos')` then request the intent; the sell screen consumes it in
  an effect and focuses the search input exactly once.
- `components/layout/app-header.tsx`: add the home affordance — the terminal/branch block,
  44 px, `data-testid="pos-home"` — so there is one way back from any screen without another
  button in a crowded bar. Plan 03 deliberately left this bullet here because `#home` does not
  exist until this plan.

### 3. Retire the chart gallery

- Delete `routes/_pos/dev-charts.tsx` and its `main.tsx` import/branch.
- Controller: drop `dev-charts.tsx` from the desktop gate's `routeExemptions`, and remove the
  now-dead `'dev-charts.tsx'` entry in `scripts/check-modules.mjs:97` (the admin gallery was
  deleted in Phase 9; the exemption outlived it).
- Phase 7's `evidence/verify-charts-desktop.mjs` **stays where it is** — it is the record of
  what Phase 7 proved. It no longer has a subject, and Plan 09's counter audit supersedes its
  assertions against the real chart. Record that in Plan 10's verification doc.

### 4. Bundle measurement (D11)

Record before and after in the plan's commit message and in the evidence file:

```bash
bun run --filter desktop build
ls -l .vite/renderer/main_window/assets/index-*.js        # bytes
gzip -c .vite/renderer/main_window/assets/index-*.js | wc -c
```

Baseline at planning time: **1,218,967 bytes / 349,210 gzip**, with Recharts already inside
because `dev-charts` imported it statically. The expectation is that the home chart is roughly
free and retiring the gallery **reduces** the bundle. If it grows by more than 250 KB, D11 says
replace the chart with a CSS bar strip — say so rather than proceeding.

### 5. Tests that must move, and why (deviation to record)

The two landing lines changed (`modules/auth/pages/login-page.tsx` and
`modules/shift/pages/shift-page.tsx` — Plan 02 moved the navigation out of the now-thin route
files). Anything that asserts the old landing must be updated **in this commit**:

- `desktop/test/e2e/security-smoke.mjs` and the packaged shell checks — landing assertions;
- `phases/06-pos-offline-core/evidence/e2e-pos.mjs` and `walkthrough-pos.mjs` — historical files,
  which stay as written; the new counter audit becomes the live proof;
- the offline relaunch leg — after relaunch the app must land on `#home` **with the figures
  intact and no network**.

Every edit is listed in the commit message. No assertion is deleted or loosened; a landing check
that no longer applies is replaced with the new landing check plus the one-hop shift redirect.

## Verification

```bash
bun run --filter desktop test
bun run --filter desktop check-types
bun run lint
bun run modules:check:pos:strict     # now expected green: `home` was the last pending module
bun run modules:check
bun run tokens:check
bun run --filter desktop test:e2e
```

Manual, with the API and PowerSync up (or with the network off — both are required):

1. Sign in with an open shift → lands on `#home`.
2. Take, items, average basket, credit, and tax agree with a hand count of the day's receipts.
3. Expected cash agrees with the close dialog's figure for the same shift.
4. Sell one item → return to `#home` → take and the current hour's bar both move.
5. Close the shift → `#shift`; reopen → `#home` with the new shift's drawer figure and the
   day's take still spanning both shifts.
6. F2 from home focuses the sell screen's search field.
7. Kill the network, relaunch, sign in → home renders correct figures with the sync badge
   reading Offline.

## Commits

1. `feat(desktop): the home screen — take, drawer, credit, and tax`
2. `feat(desktop): the day's hourly shape with a summary and a table alternative`
3. `feat(desktop): top sellers and the needs-attention strip`
4. `feat(desktop): #home lands after sign-in and after opening a shift`
5. `feat(desktop): a home affordance in the counter chrome`
6. `chore(desktop): retire the dev-charts gallery and measure the bundle`
7. `chore(scripts): drop the dev-charts route exemptions` (controller)
8. `test(desktop): update the landing assertions for #home`

## Done when

- `#home` is the landing screen after sign-in and after opening a shift; `#pos` still means
  selling everywhere it already did.
- The take, drawer, credit, tax, items, average basket, hourly shape, top five, and attention
  strip all render from local SQLite with the network unplugged and after a relaunch.
- The chart carries an accessibility layer, a summary sentence, and a data-table alternative,
  and is keyboard-operable with the pointer parked off-chart.
- `modules:check:pos:strict` is green over all fourteen modules.
- The bundle figure is recorded, and it did not grow past D11's budget.
