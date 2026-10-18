---
phase: 02-catalog-pricing
plan: 01
wave: 1
title: Shared tax engine and pricing helpers
requirements: [CAT-06, CAT-07]
depends_on: []
status: planned
created: 2026-10-18
---

# Plan 01 — Ghana Tax Engine and Pricing Helpers (shared)

**Goal:** Pure, integer-only tax and pricing functions live in `@gikautos/shared` so the
API, the console preview, and the Phase 6 offline POS all compute identically.

## Task 1 — Tax engine

**Files:** `packages/shared/src/tax.ts`, `packages/shared/src/tax.test.ts`,
`packages/shared/src/index.ts`

- Types: `TaxCategory = 'STANDARD' | 'ZERO_RATED' | 'EXEMPT'`,
  `TaxMode = 'INCLUSIVE' | 'EXCLUSIVE'`,
  `TaxBreakdown { baseMinor, vatMinor, nhilMinor, getfundMinor, taxTotalMinor, totalMinor }`.
- Rates as basis points: VAT 1500, NHIL 250, GETFund 250 (constants exported for
  receipts/reporting).
- `taxBreakdown(amountMinor, category, mode): TaxBreakdown`:
  - `STANDARD` exclusive: `base = amount`; each component `round(base × bp / 10000)`;
    `total` is the exact sum.
  - `STANDARD` inclusive: `base = round(total × 10000 / 12000)`; components on `base`;
    residual `total − sum` added to VAT so the breakdown sums exactly.
  - `ZERO_RATED`/`EXEMPT`: `base = amount`, components 0.
  - Throws `TypeError` on non-integer, negative, or unsafe-integer amounts.
- `addTaxBreakdowns(...breakdowns): TaxBreakdown` for invoice totals (integer sums).
- `zeroBreakdown(amountMinor)` convenience for zero-rated/exempt lines.

**Verify:** tests cover the GRA worked example (base 100,000 pesewas → NHIL 2,500,
GETFund 2,500, VAT 15,000, total 120,000); inclusive inverse (120,000 inclusive → base
100,000, exact components); residual invariant `base + vat + nhil + getfund === total`
for every amount 0…200,000 pesewas; zero/exempt; `addTaxBreakdowns`; rejects `1.5`,
`-1`, `NaN`.
**Commit:** `feat(shared): add ghana tax engine with integer breakdowns`

## Task 2 — Pricing helpers

**Files:** `packages/shared/src/pricing.ts`, `packages/shared/src/pricing.test.ts`,
`packages/shared/src/index.ts`

- `resolveEffectivePrice(basePriceMinor, overrideMinor): number` — returns the override
  when non-null, else the base; throws on invalid inputs.
- `isValidPriceMinor(value): boolean` — non-negative safe integer.

**Verify:** tests cover override precedence, null override, and invalid inputs; shared
suite stays green (`bun run --filter @gikautos/shared test`).
**Commit:** `feat(shared): add price resolution helpers`

## Done When

`@gikautos/shared` exports the tax engine and pricing helpers with exhaustive tests; the
API and console can import them without any runtime dependency.
