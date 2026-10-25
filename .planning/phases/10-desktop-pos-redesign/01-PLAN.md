---
phase: 10-desktop-pos-redesign
plan: 01
title: Shared counter maths, local schema indexes, and the desktop module gate
lane: shared (packages/** first, alone) + controller
depends_on: []
requirements: [UIX-08, UIX-09]
---

# Plan 01 — Shared counter maths, local schema, and the module gate

## Goal

Three things are written once before any screen is touched: the **day window** every
terminal figure is counted in, the **average basket** rounding the API already uses, and the
**module gate** the rest of the phase is measured by. The local `sale` table gains the index
the home screen needs, the database gains a prepared-statement cache, and the index change is
proven to migrate a database that already holds sales.

Nothing in this plan changes a screen, a route, or a money rule.

## Read first

- `AGENTS.md` rules 4 and 5 (integer money, append-only).
- `00-DECISIONS.md` P10-D3, P10-D12, P10-D13, P10-D15.
- `packages/shared/src/dates.ts:155-200` — `accraDay`, `accraIsoDay`, `formatAccraDateTime`.
- `packages/shared/src/percent.ts` — the rounding and integer-validation conventions to copy.
- `api/src/modules/analytics/analytics.service.ts:250-300` — the inline average basket.
- `desktop/src/renderer/lib/powersync/schema.ts:205-243` — the `sale` table and its indexes.
- `desktop/src/renderer/lib/powersync/database.ts:46-70` — the open factory.
- `scripts/check-modules.mjs` — the admin gate, in full, before refactoring it.
- `phases/08-admin-modules-shell/evidence/verify-module-gate.mjs` — the 20/20 mutation proof.

## Tasks

### 1. Day bounds in `packages/shared/src/dates.ts`

```ts
export interface AccraDayBounds {
  /** "2026-10-25" — the day every terminal figure is counted in. */
  day: string
  /** ISO timestamp of that day's 00:00 UTC (= 00:00 Accra). */
  from: string
  /** ISO timestamp of the next day's 00:00 UTC — the exclusive upper bound. */
  to: string
}

/** The Accra day containing `now`, as [from, to). Africa/Accra is UTC+0 all year. */
export function accraDayBounds(now: Date | number = new Date()): AccraDayBounds

/** Milliseconds until the next Accra midnight. Always in (0, 86_400_000]. */
export function msUntilNextAccraDay(now: Date | number = new Date()): number
```

Rules: derive `from`/`to` from UTC parts, never by adding 86 400 000 to a formatted string —
a day is not always 24 hours if the offset ever changes, and the arithmetic must survive the
one place it is wrong today. `msUntilNextAccraDay` returns a value in `(0, 86_400_000]`; at
exactly midnight it returns a full day, never zero (a zero timeout is a busy loop).

Tests (`dates.test.ts`):

- a mid-morning instant yields that day's bounds and `from < value < to`;
- 23:59:59.999 UTC yields the *same* day, and one millisecond later the next;
- `msUntilNextAccraDay` at 12:00 is 12 h, at 00:00:00.000 is 24 h, at 23:59:59.999 is 1 ms;
- the pair is consistent: `new Date(bounds.to) − new Date(bounds.from) === 86_400_000`;
- with `TZ` stubbed to `Pacific/Kiritimati` (UTC+14) the bounds are unchanged — they are
  defined in Accra, not in the host's zone.

### 2. `packages/shared/src/money.ts`

```ts
/**
 * Average basket in integer minor units: round(take / salesCount), 0 when there are no
 * sales. The only division in the codebase that produces a money value, and it rounds once.
 */
export function averageBasketMinor(takeMinor: number, salesCount: number): number
```

Rules: both inputs are safe integers ≥ 0 (`TypeError` otherwise); no float escapes; the doc
comment states that this is a **display** figure and is never posted anywhere. Export from
`packages/shared/src/index.ts` in the existing alphabetical order (between `inventory` and
`percent`).

Tests (`money.test.ts`): `0/0 → 0`; `15000/1 → 15000`; `24500/2 → 12250`; `100/3 → 33`;
`200/3 → 67`; a negative or non-integer argument throws; large safe integers round once.

### 3. The API adopts the helper (controller — one call site)

`api/src/modules/analytics/analytics.service.ts:256-261` and `:387` replace the inline
expression with `averageBasketMinor(...)`. `analytics.test.ts:463` (`15_000`) must pass
unchanged: the behaviour is identical, only the location moves.

This is the **only** API file this phase touches. If any other API change becomes necessary,
stop and ask — Phase 10 adds no endpoint and no server rule.

### 4. Local schema: index the day window

`desktop/src/renderer/lib/powersync/schema.ts:242`:

```ts
{ localOnly: true, indexes: {
    sale_shift: ['shift_id'],
    sale_occurred: ['occurred_at'],
    sale_terminal_occurred: ['terminal_id', 'occurred_at'],
} }
```

`terminal_id` first, because every home query filters on it and only then on the day. Keep
both existing indexes: `sale_occurred` serves the sales-screen scan and `sale_shift` serves the
shift close.

### 5. Prepared-statement cache

`database.ts:53-63` — add `preparedStatementsCache: 64` to the `open` object. Verified present
on `ResolvedWebSQLOpenOptions` in `@powersync/web` 2.5.0. One line, with a comment naming the
seven home aggregates as the reason.

### 6. Prove the migration on a populated database (P10-D15)

`desktop/src/renderer/lib/powersync/schema-migration.test.ts`:

1. open a database with the **previous** schema shape (import the current `PosSchema` from a
   frozen inline copy of the `sale` index list without `sale_terminal_occurred`);
2. write one shift, two sales, their lines, tenders, a cash movement, and three pending outbox
   rows;
3. close, then reopen with `PosSchema` as the factory builds it (`OPFSCoopSyncVFS` is not
   available under vitest — use the IDB VFS the spike proved, or the in-memory VFS the existing
   `spike.test.ts` uses; whichever the file already proves works in Node);
4. assert every row still reads, both new and old, and that `EXPLAIN QUERY PLAN` for
   `SELECT ... FROM sale WHERE terminal_id = ? AND occurred_at >= ? AND occurred_at < ?`
   names `sale_terminal_occurred`.

If a Node-compatible VFS cannot run the migration test, the case runs in the packaged Electron
harness instead and this plan records the substitution. Do not weaken it to a mock — P10-D15
exists because the failure mode is a till holding an unuploaded day.

### 7. `scripts/lib/module-rules.mjs` and a desktop client (controller)

Extract the rule engine from `scripts/check-modules.mjs` into `scripts/lib/module-rules.mjs`
with a config object:

```js
runModuleCheck({
  name: 'admin' | 'desktop',
  srcDir, routesDir, modulesDir,
  requiredModules: [...],
  pendingModules: [...],          // fail only under --strict
  deferredModules: {},
  allowedEntries: ['api','components','hooks','pages','types','ui','utils','index.ts'],
  globalFolders: ['ui','common','layout'],
  routeExemptions: [{ file, reason }],
  maxRouteLines: 25,
})
```

- `scripts/check-modules.mjs` becomes a thin admin caller with **identical output and exit
  codes**. The refactor must not change one byte of its report.
- `scripts/check-desktop-modules.mjs` is the desktop caller. Its `requiredModules` are D1's
  fourteen: `auth, cart, catalog, credit, customers, home, loyalty, receipt, sales, sell,
  settings, shift, sync, tender`. Its `pendingModules` starts as all fourteen and each plan
  deletes its own entry; `--strict` fails while any remain.
- `routeExemptions` for the desktop: `_pos/app.tsx` (the guard ladder), `_pos/dev-sync.tsx`,
  `_pos/dev-print.tsx` — each with a written reason, as the admin gate does.
- Root `package.json`: `modules:check:pos` and `modules:check:pos:strict`. **Do not** add the
  strict desktop gate to `modules:check:strict` yet — Plan 10 does that when the desktop is
  clean. A gate that is red for eight plans teaches everyone to ignore it (Phase 8's own
  reasoning).
- `desktop/biome.json`: widen `noRestrictedImports` from
  `@/modules/*/{components,ui,hooks,api}` to `@/modules/*/*` plus `@/modules/*/*/**`, matching
  the admin pattern, message unchanged in meaning.

**Then re-prove the admin gate.** Run
`node .planning/phases/08-admin-modules-shell/evidence/verify-module-gate.mjs` and require
**20/20**. A refactor that quietly stops failing is worse than no refactor.

### 8. `desktop/src/renderer/modules/README.md`

One page: the folder contract from P10-D10, the "`ui/` never queries" rule, the
"one owning component per module" rule from P10-D11, and the note that a folder appears only
when it has content (Phase 8's D2 refinement). This file is what the gate's messages point at.

## Verification

```bash
bun run --filter @sceptre/shared test
bun run --filter @sceptre/shared check-types
bun run --filter api test
bun run --filter desktop test
bun run check-types
bun run lint
bun run modules:check
node .planning/phases/08-admin-modules-shell/evidence/verify-module-gate.mjs
```

Expected:

- shared tests grow by ~15 (day bounds, next-midnight, average basket); API suite unchanged and
  green;
- desktop tests grow by 1 migration case and one "index is used" assertion; all existing cases
  pass **unedited**;
- `modules:check` reports the desktop as 0/14 with the same hard-rule enforcement;
- the admin gate mutation proof is 20/20;
- no HTML, CSS, or TSX under `desktop/src/renderer/{routes,components}` changed.

## Commits

1. `feat(shared): Accra day bounds, the next midnight, and average basket`
2. `refactor(api): the analytics service uses the shared average basket`
3. `perf(desktop): index sales by terminal and day, and cache prepared statements`
4. `test(desktop): prove a populated database migrates to the new local schema`
5. `chore(scripts): extract the module rules and add the desktop client` (controller)
6. `docs(desktop): the renderer module contract`

## Done when

- `accraDayBounds`, `msUntilNextAccraDay`, and `averageBasketMinor` are exported from
  `@sceptre/shared` and covered by tests, including the host-timezone case.
- The API computes average basket by calling the shared helper, with an unchanged suite.
- `sale` is indexed on `(terminal_id, occurred_at)` and the home-shaped query plans through it.
- The local database opens with a prepared-statement cache.
- `modules:check` enforces hard rules on both clients; the desktop reports its fourteen
  pending modules; the admin gate still fails 20/20 mutations.
- No route, component, or stylesheet changed. No migration, no endpoint, no sync config change.
