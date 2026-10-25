---
phase: 10-desktop-pos-redesign
plan: 09
title: Counter audit — widths, keyboard, reduced motion, and offline copy
lane: verification (read-only; writes only its own evidence)
depends_on: [08]
requirements: [UIX-09]
---

# Plan 09 — Counter audit

## Goal

Prove, against a real enrolled terminal driving a real sale, that the phase's claims are true:
the home figures are correct and correct offline, every screen fits and is operable at the
smallest supported counter size, nothing is hover-only, and every target is reachable with a
glove on.

The audit is a **gate in the package** (`bun run --filter desktop test:counter`), not a one-off
transcript, so the next phase inherits it.

## Read first

- `00-CONTEXT.md` D8, D13; `00-DECISIONS.md` P10-D8 (light only), P10-D14 (chart rules).
- `desktop/test/e2e/security-smoke.mjs` — the Playwright + `_electron` harness, packaged binary
  path, and the check counter to copy.
- `phases/07-identity-design-system/evidence/verify-charts-desktop.mjs` — the chart assertions
  to supersede (four containers, no horizontal scroll, no zero-height chart, no animation under
  reduced motion, first series `rgb(242,106,27)`, tooltip on hover **and** keyboard focus, no
  off-machine request).
- `phases/09-analytics-dashboard/01-RESEARCH.md` — recharts#7905: park the pointer off-chart
  before asserting arrow keys, or the test flakes.
- `admin/test/walkthrough-sections.mjs` — the shape of a walkthrough that signs in once and then
  runs a matrix.

## Prerequisites

- API up (`bun run dev:api`), Postgres up, PowerSync up (`bun run sync:up`), demo seed applied.
- `bun run --filter desktop package` completed. *(Correction after execution: the audit drives
  the **unpackaged** production build, not the packaged binary. A packaged app sets
  `allowLocalOrigins: false` by design — a shipped terminal must never be pointed at a local
  impersonator — so it cannot enrol against a localhost API. Same `.vite` bundle, `app://`
  origin, preload bridge, and CSP; `security-smoke.mjs` still proves the packaged binary.)*
- A dedicated terminal is enrolled per run, as Phase 7's POS walkthrough does: never delete a
  shipped row to make room for a fixture.

The script fails with exit code 2 and a named prerequisite when any of these is missing, rather
than failing assertions that were never reached.

## The audit

`desktop/test/e2e/counter-audit.mjs`, added as `test:counter` in `desktop/package.json`.

### 1. Boot and enrol (≈8 checks)

Fresh `userData` → the first screen is **enrolment** (the defect Plan 08 fixed) → redeem a code →
temporary PIN → forced change → PIN pad sign-in.

### 2. Open a shift and sell (≈10 checks)

Open a shift with a known float; sell three known baskets (one cash with change, one exact cash,
one credit against a customer with headroom). Record each total in **integer minor units** in the
script — the script owns the expected arithmetic, and compares formatted strings so no float
comparison enters the test.

### 3. Home correctness (≈12 checks)

- Landing is `#home` after sign-in and after opening a shift.
- Take equals the sum of the three totals; items equals the sum of quantities; average basket
  equals `averageBasketMinor(take, count)` from `@sceptre/shared` (the same helper, imported).
- Credit given equals the credit sale's total; tax is non-zero and less than the take.
- Expected cash equals float + cash tendered − change (computed by the script from what it did).
- The current hour's bar is the only `--brand` bar; the peak sentence names a real hour.
- The top-five list contains the product sold most, first.
- The attention strip shows one unprinted receipt **only if** printing is unavailable in this
  build; otherwise assert it is absent. Whichever it is, assert the *rule*, not a hard-coded
  count.

### 4. The matrix (≈20 checks)

Three viewports — **1024 × 768** (the smallest supported counter), 1366 × 768, 1920 × 1080 — over
every screen: home, sell, tender, receipt, sales, shift, sync, settings, login.

For each screen:

- `document.documentElement.scrollWidth <= clientWidth + 1` (no horizontal scroll — the Phase 7
  defect that pushed a page to 953 px);
- the primary action is inside the viewport without scrolling;
- every interactive element's `getBoundingClientRect()` is ≥ 44 × 44;
- with `reducedMotion: 'reduce'`, no transition exceeds 1 ms (the Phase 7 test-defect lesson:
  compare parsed durations, not the string `0s`);
- one screenshot per screen at 1024 × 768 into
  `.planning/phases/10-desktop-pos-redesign/evidence/shots/`.

Two assertions that must be written to be able to fail (both were mis-specified during planning):

- **A clamped product name needs an unclamped clone.** `scrollHeight <= clientHeight` on a
  `-webkit-line-clamp` element is always true — the clamp sets both to the clamped height. Clone
  the element, drop the clamp, and assert its required height fits the allowed line count.
- **A target's box is not its hit area.** Measure the element that owns the pointer handler; where
  a dense row pads the hit area with a `::after` overlay or extra padding, the box that matters is
  the padded one. Assert on what the browser hit-tests (`document.elementFromPoint` at the box's
  corners), not only on `getBoundingClientRect()`.

### 5. Keyboard path (≈8 checks)

From the home screen, with no pointer: `Tab` reaches Start selling → `Enter` → the search field is
focused (P10-D7's F2 intent also asserted) → type a SKU → `Enter` adds → `F9` → tender → digits →
`F9` → receipt. Assert at each hop that focus is visible (a non-`none` outline) and that the
focused element's computed outline colour resolves to the brand ink.

### 6. Chart accessibility (≈6 checks)

One tab stop for the chart; arrow keys change the active point **with the pointer parked at
(0,0)**; the summary sentence is present in the DOM; the `<details>` table has 24 rows.

### 7. Offline (≈8 checks)

Using the driver's network emulation (`Network.emulateNetworkConditions` offline), never by
killing a service the script does not own:

- the sync badge reports Offline without an error style;
- a sale still completes and the home figures move;
- quit and relaunch: the app lands on `#home` with the figures intact and no network;
- the outbox shows the waiting count, and the attention strip names it.

### 8. Static checks (≈4 checks)

- zero raw Tailwind palette classes outside the four diagnostic surfaces
  (`#dev/sync`, `#dev/print`, `#spike`, `#diagnostics`);
- the renderer bundle size is printed and recorded for Plan 10 (no assertion — D11's budget is
  judged and reported, not silently tolerated);
- `desktop/src/renderer/modules/**/ui/**` imports no `@powersync/react`;
- no `toFixed(` in the renderer's non-test sources.

Target: **≥ 60 checks**, each printing `PASS`/`FAIL` with a label, the Phase 6/7 convention.
Delivered: **150 checks**, plus nine screenshots and `evidence/bundle.json`.

*(Correction after execution: two defects were found and fixed rather than asserted around —
the tender keypad was pointer-only for cash entry, and the tender screen reported "no credit
account" while its local read was still running, which could open a manager override for a sale
that needed none.)*

## Verification

```bash
bun run --filter desktop test:counter
```

Expected: ≥ 60/60 with the stack up, plus a screenshot set. A failure is a finding to fix in the
plan that owns the screen, not an assertion to loosen — the same rule as Phase 8's review.

## Commits

1. `test(desktop): the counter audit — boot, sell, and home correctness`
2. `test(desktop): the width, target, and reduced-motion matrix`
3. `test(desktop): the keyboard path and chart accessibility`
4. `test(desktop): the offline leg and relaunch`
5. `chore(desktop): wire test:counter and record the bundle figure`

*(Correction after execution: four commits, not five. The audit is one new file, so slicing it
into four commits would have committed the same script four times with more of it each time.
The two defects it found got their own commits instead, which is the more useful history.)*

## Done when

- `bun run --filter desktop test:counter` runs from the repository root and reports ≥ 60/60.
- Every screen is proven at 1024 × 768, and the home screen is proven correct offline and after
  a relaunch.
- The keyboard path completes a sale without a pointer.
- Screenshots exist for every screen at the smallest counter size.
