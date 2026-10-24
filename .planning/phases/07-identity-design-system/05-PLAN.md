---
phase: 07-identity-design-system
plan: 05
wave: 2
title: date-fns in shared, admin, and desktop
requirements: [UIX-05]
depends_on: [01]
status: planned
created: 2026-10-24
---

# Plan 05 — `date-fns` in Shared, Admin, and Desktop

**Goal:** Every date and time in the product is rendered by one small, tested helper set
built on `date-fns@4`, so a receipt, a ledger row, and a chart axis agree on how a date
looks.

## Task 1 — Install and catalogue

**Files:** `package.json` (workspaces catalog), `packages/shared/package.json`,
`admin/package.json`, `desktop/package.json`

- Add `"date-fns": "4.4.0"` to the root `workspaces.catalog`. Every consumer references
  `"date-fns": "catalog:"`, matching how `zod`, `vitest`, and `react` are handled.
- Add it to `packages/shared` `dependencies`, `admin` `dependencies`, and `desktop`
  `devDependencies` (the desktop's renderer packages live in `devDependencies` so Vite
  bundles them and Forge does not treat them as runtime externals).
- `bun install`; confirm one version resolves across the workspace
  (`bun pm ls | grep date-fns`).

**Verify:** `bun install` exits 0; `bun pm ls | grep date-fns` shows a single 4.4.0.

**Commit:** `chore(deps): add date-fns to the catalog`

## Task 2 — The shared date helpers

**Files:** `packages/shared/src/dates.ts`, `packages/shared/src/dates.test.ts`,
`packages/shared/src/index.ts`

Implement and export:

| Function | Signature | Output |
|---|---|---|
| `formatDay` | `(value: string \| number \| Date) => string` | `24 Oct 2026` |
| `formatDayShort` | same | `24 Oct` |
| `formatDateTime` | same | `24 Oct 2026, 14:32` |
| `formatTime` | same | `14:32` |
| `formatMonth` | same | `Oct 2026` |
| `formatRange` | `(from, to) => string` | `1–24 Oct 2026`, `28 Sep – 4 Oct 2026`, `1 Dec 2025 – 4 Jan 2026` |
| `formatRelative` | `(value, now?) => string` | `2 min ago`, `yesterday`, `in 3 days` |
| `formatBucket` | `(iso, granularity) => string` | `24 Oct` / `Wk 43` / `Oct 2026` — chart axes |
| `formatCount` | `(n: number) => string` | `1,240` (integer grouping for points and counts) |
| `toDateInputValue` | `(value) => string` | `2026-10-24` for `<input type="date">` |
| `toDateTimeInputValue` | `(value) => string` | `2026-10-24T14:32` for `<input type="datetime-local">` |
| `accraDay` | `(now?) => string` | `20261024` — moved from `desktop/src/renderer/lib/time.ts` |

Rules:
- Locale `en-GB`. Ghana retail reads `24 Oct 2026`, not `10/24/2026`.
- Accept `string | number | Date` and parse strings with `parseISO`; return `"—"` for an
  invalid date rather than `Invalid Date`.
- Never return a `number`. Formatting is a display concern only. **No helper divides money
  by 100** — `formatGhs` stays the single money formatter.
- Africa/Accra is UTC+0 year-round; no timezone library is added. Document that in the file
  header so a later phase does not add `@date-fns/tz` unnecessarily.

Tests must cover: a normal date, a leap day (`2028-02-29`), the range formatter's three
shapes (same month, same year, cross year), `formatRelative` for past/future/now,
`formatBucket` for all three granularities, `formatCount` grouping, and invalid input
returning `—`. Shared suite grows from 73 to at least 90.

**Verify:** `bun run --filter shared test` passes; `bun run --filter shared check-types`
passes.

**Commit:** `feat(shared): add date and count formatting helpers`

## Task 3 — Admin adoption

**Files:** `admin/src/lib/format.ts`, `admin/src/lib/loyalty.ts`,
`admin/src/routes/_authenticated/index.tsx`,
`admin/src/components/suppliers/supplier-overview.tsx`,
`admin/src/components/customers/{credit-ledger-table,loyalty-history-table,liability-report,statement-view}.tsx`,
`admin/src/components/payables/**`, `admin/src/routes/_authenticated/**` (date inputs)

- `admin/src/lib/format.ts`: delete the local `formatDay`; re-export the shared one so
  existing imports keep working, or update the importers (prefer updating — one `grep`).
- Replace date rendering (7 call sites found by
  `grep -rn 'toLocaleDateString\|toLocaleString("en-GH", { dateStyle' admin/src`): use
  `formatDay` for dates, `formatDateTime` for ledger rows and timestamps, `formatRelative`
  only where "how long ago" is the actual question (sync/audit context), never in a ledger.
- Replace number grouping (`points`, `counts`, `invoicesOpen`) with `formatCount`. **Do not**
  touch `formatGhs` / `formatMinorPlain` — money formatting is unchanged.
- Replace the `new Date().toISOString().slice(0, 10)` date-input defaults with
  `toDateInputValue(new Date())`, and the `datetime-local` helper in
  `payment-form-dialog.tsx` with `toDateTimeInputValue`.
- `admin/src/lib/loyalty.ts`: `daysUntil` and `isExpiringSoon` use `differenceInCalendarDays`
  and `isAfter` instead of millisecond arithmetic, so a DST change or a partial day cannot
  flip a result.
- Do not introduce `date-fns` directly in a component when a shared helper exists; a direct
  import is only acceptable for an interval calculation (`eachDayOfInterval`, `startOfMonth`).

**Verify:** `grep -rn 'toLocaleDateString\|dateStyle' admin/src` returns nothing;
`bun run --filter admin check-types` and `bun run --filter admin build` pass; a manual pass
over the customers ledger, statement, payables aging, and the audit list shows
`24 Oct 2026, 14:32` consistently.

**Commit:** `refactor(admin): format all dates through date-fns helpers`

## Task 4 — Desktop adoption

**Files:** `desktop/src/renderer/lib/time.ts` (delete or re-export),
`desktop/src/renderer/lib/format.ts`, `desktop/src/renderer/routes/_pos/sales.tsx`,
`desktop/src/renderer/components/pos/receipt-view.tsx`,
`desktop/src/renderer/components/pos/{sync-log,conflict-list}.tsx`,
`desktop/src/renderer/routes/_pos/{shift,sync,settings}.tsx`

- Move `accraDay` to `@sceptre/shared` and re-export it from `lib/time.ts` (or delete the
  file and update the one importer).
- Receipt: the printed date must stay **deterministic and fixed-width** for the 42-column
  ESC/POS layout. Use `formatDay`/`formatTime` and assert the rendered line length is
  unchanged in `receipt/render.test.ts`. A longer month name would break the paper layout —
  this is the one place where the format is a hardware contract, not a preference.
- Sync log and conflict list: `formatRelative` for "last attempt", `formatDateTime` for
  absolute timestamps.
- Shift screen: `formatDay` for the shift date, `formatTime` for open/close.
- Number grouping on totals stays `formatGhs`; item counts use `formatCount`.

**Verify:** `bun run --filter desktop test` — 339 + the new date tests pass;
`receipt/render.test.ts` proves the receipt columns are unchanged; the shift and sales
screens show the new format in a manual launch.

**Commit:** `refactor(desktop): format all dates through date-fns helpers`

## Definition of Done

- `date-fns` resolves once at 4.4.0.
- `packages/shared/src/dates.ts` is the only place date formats are chosen.
- No `toLocaleDateString`/`dateStyle` remains in either app; no `toLocaleString` remains for
  dates (number grouping goes through `formatCount`).
- Receipt layout test still passes — the till's paper is unchanged.
