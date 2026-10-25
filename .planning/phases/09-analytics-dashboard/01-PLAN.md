---
phase: 09-analytics-dashboard
plan: 01
title: Shared contract — basis points, CSV, Accra day, analytics.read, seven-step ramp
lane: shared (packages/** first, alone)
depends_on: []
requirements: [ANL-02, ANL-03, ADM-02]
---

# Plan 01 — Shared contract

## Goal

`@sceptre/shared` owns the one way to express a percentage delta, the one way to write a
CSV cell, and the one way to name an Accra calendar day; `analytics.read` exists and is
granted to ADMIN and MANAGER; `@sceptre/brand` has seven chart steps verified by
`tokens:check`. Nothing in this plan touches the API, the clients, or the database.

## Read first

- `AGENTS.md` rules 4–6 (integer money, append-only, no secrets).
- `packages/shared/src/dates.ts` — the formatter contract and its doc comment.
- `packages/shared/src/permissions.ts` — permission catalogue and role lists.
- `packages/brand/src/tokens.css` — chart ramp, `@theme inline` mapping, dark block.
- `scripts/check-tokens.mjs:81,344` — `REQUIRED_CHART` and the app-stylesheet guard.
- `00-DECISIONS.md` P9-D3, P9-D8.

## Tasks

### 1. `packages/shared/src/percent.ts`

```ts
export const BASIS_POINT_SCALE = 10_000

/** Percent change from previous to current. null when previous is 0 — never Infinity. */
export function deltaBp(previous: number, current: number): number | null

/** part/whole as basis points. null when whole is 0. */
export function ratioBp(part: number, whole: number): number | null

/** "+12.40%", "-3.10%", "0.00%", "—" for null. Sign is explicit except at zero. */
export function formatBasisPoints(bp: number | null): string
```

Rules: both inputs must be safe integers (`Number.isSafeInteger`) — throw `TypeError`
otherwise; only one rounding at the end (`Math.round`); no float is ever stored, returned as
money, or multiplied into a total. Export from `packages/shared/src/index.ts` (keep the
alphabetical order used there).

Tests (`percent.test.ts`): 0 → null; 100 → 0 ("0.00%"); 1 000 → 1 100 = `1000` bp; negative
direction keeps the sign; `.5` rounds away from zero per `Math.round`; `ratioBp(1, 3)` =
3333; huge safe integers do not lose precision beyond the final round; non-integer input
throws.

### 2. `packages/shared/src/csv.ts`

```ts
export const CSV_DANGEROUS_PREFIX = /^[=+\-@\t\r\n＝＋－＠]/

export interface CsvColumn<T> { key: keyof T & string; header: string }

/** One RFC 4180 cell: quote, double quotes, prefix a leading apostrophe when dangerous. */
export function csvCell(value: string | number | null | undefined): string

/** CRLF rows, header row, optional UTF-8 BOM. No trailing blank line. */
export function toCsv<T extends Record<string, string | number | null>>(
  columns: ReadonlyArray<CsvColumn<T>>,
  rows: ReadonlyArray<T>,
  options?: { bom?: boolean },
): string
```

Rules: numbers are rendered with `String(value)` and must be safe integers (money is never
formatted in CSV — a spreadsheet must receive exact pesewas); `null`/`undefined` become an
empty cell; a cell containing `,`, `"`, CR, LF, or leading/trailing space is quoted; quotes
are doubled; the doc comment records the Excel escape-stripping trade-off from P9-D8 and why
the TAB variant is not used.

Tests (`csv.test.ts`): the two OWASP examples (`=1+2";=1+2` and `=1+2'" ;,=1+2`) produce the
documented outputs; `＝1+2` and `＠SUM(1)` are prefixed; a name with a comma/newline is
quoted; CRLF endings; BOM present by default and absent with `bom: false`; empty rows still
emit a header; a negative money value renders `-1250` (not `'‑1250`) because it is a number,
not a formula — assert this deliberately so the rule is understood.

### 3. Accra calendar day in `packages/shared/src/dates.ts`

```ts
/** "2026-10-24" — the UTC calendar day, which is the Accra day all year. */
export function accraIsoDay(value?: DateInput): string
```

Implement from UTC parts (`getUTCFullYear`/`getUTCMonth`/`getUTCDate`), never
`toISOString().slice(0, 10)` inline in a service. Add tests, including that
`formatBucket('2026-10-24', 'day') === '24 Oct'` and `formatBucket('2026-10-24', 'week')`
matches the ISO week, with `process.env.TZ` set to a non-UTC zone in the test (vitest
`TZ` env or `vi.stubEnv`) to prove the date-only string does not shift a day.

### 4. `analytics.read`

- `PERMISSIONS`: add `'analytics.read'` after `'settings.update'`.
- `MANAGER_PERMISSIONS`: add `'analytics.read'` next to `'audit.read'`.
- `ADMIN_PERMISSIONS` derives from `PERMISSIONS`, so admins gain it automatically.
- `permissions.test.ts` keeps passing (admins get every permission, cashiers none, no
  duplicates). Add an explicit assertion that a MANAGER can read analytics and a CASHIER
  cannot.

### 5. Seven-step chart ramp

`packages/brand/src/tokens.css`:

- light: `--chart-6: #5b6ea8; --chart-7: #8c5a8f;`
- dark: `--chart-6: #8fa3d8; --chart-7: #c08fc4;`
- `@theme inline`: `--color-chart-6`, `--color-chart-7`.
- Extend the ramp comment: order is by series priority, verified against `--surface`.

`NEEDS_LANE_CHANGE` → controller updates `scripts/check-tokens.mjs`:
`REQUIRED_CHART` to seven entries, and the app-stylesheet guard regex from
`chart-[1-5]` to `chart-[1-7]`. Add a contrast assertion that every chart token reaches
**3:1 against `--surface`** in its theme (the values are in P9-D3; the existing
`check-tokens.mjs` already computes WCAG relative luminance from the token file, so reuse
it). Do **not** assert against `--canvas`: `--chart-1` is 2.83:1 there, and chart panels are
required to sit on `bg-card`.

## Verification

```bash
bun run --filter @sceptre/shared test
bun run --filter @sceptre/shared check-types
bun run --filter @sceptre/shared lint
bun run tokens:check
bun run brand:check
bun run check-types
```

Expected: shared tests grow by roughly 25; `tokens:check` passes over seven chart tokens in
both themes; `brand:check` clean (no new brand hex outside `packages/brand`); nothing in
`admin/src` or `desktop/src` changed.

## Commits

1. `feat(shared): basis-point deltas, CSV cells, and the Accra calendar day`
2. `feat(shared): analytics.read permission for admins and managers`
3. `feat(brand): extend the chart ramp to seven steps`
4. `chore(scripts): require seven chart tokens and chart/surface contrast` (controller)

## Done when

- `deltaBp`, `ratioBp`, `formatBasisPoints`, `csvCell`, `toCsv`, `accraIsoDay` are exported
  from `@sceptre/shared` and covered by tests, including the OWASP and timezone cases.
- `can('MANAGER', 'analytics.read')` is true; `can('CASHIER', 'analytics.read')` is false.
- `tokens:check` enforces seven steps and their surface contrast.
- No API, admin, desktop, migration, or seed file is modified.
