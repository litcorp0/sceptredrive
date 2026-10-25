# Phase 9 — Analytics, Dashboard & Reporting Read Models

Eight plans. Plans are prompts: execute one at a time, commit atomically, verify before
moving on.

| Plan | Title | Lane | Depends on |
|---|---|---|---|
| 01 | Shared contract: basis points, CSV, Accra day, permission, 7-step ramp | shared + controller | — |
| 02 | Analytics module core and `GET /api/analytics/overview` | api | 01 |
| 03 | `sales`, `products`, `tax` read models + CSV export | api | 02 |
| 04 | `inventory`, `credit`, `loyalty`, `payables` read models | api | 03 |
| 05 | `seed:demo-sales` — a realistic month through the service layer | api | 04 |
| 06 | Admin `analytics` module: `/analytics` with URL state and seven tabs | admin | 04 |
| 07 | Dashboard rebuild, nav, `dev-charts` retirement | admin | 06 |
| 08 | Verification: walkthrough, browser evidence, perf, docs | verification | 05, 07 |

## Why this order

- **01 is alone and first.** It changes `packages/shared` and `packages/brand`, which both
  clients and the API import. The controller hands the exported names to the lanes.
- **02 → 03 → 04 are sequential.** They share one module directory; two writers would
  collide. Each ends with a green suite.
- **05 is API-only** but needs the read models to prove itself.
- **06 can start as soon as 04 merges** because all eight response shapes are frozen by then.
- **07 follows 06** because the dashboard reuses the analytics chart components.
- **08 runs when every lane is idle.** No repository-wide gate while a lane is writing.

## Root-file ownership (controller edits, lanes report `NEEDS_LANE_CHANGE`)

- `package.json` — the new `seed:demo-sales` script (Plan 05).
- `scripts/check-tokens.mjs` — `REQUIRED_CHART` from 5 to 7 and the app-stylesheet guard
  regex from `chart-[1-5]` to `chart-[1-7]` (Plan 01).
- `scripts/check-modules.mjs` — `analytics` leaves `DEFERRED_MODULES` and joins
  `REQUIRED_MODULES`; `dev-charts.tsx` leaves `ROUTE_EXEMPTIONS` (Plans 06 and 07).
- `.planning/**` — state, roadmap, evidence (Plan 08).

## Locked decisions carried from `00-CONTEXT.md`

D1 server-side read models only · D2 eight endpoints · D3 `analytics.read` + branch scope
with 403 · D4 reuse `branchScope`/`assertBranchAccess`/`resolveBranchFilter` · D5 integer
minor units and integer basis points · D6 ISO period, ≤ 366 days, comparison computed
server-side · D7 URL-held period/branch/granularity/tab · D8 dashboard content · D9
analytics tabs · D10 chart rules · D11 empty/loading/error · D12 server-side CSV with
formula-injection escaping · D13 existing indexes, no migration, no materialised view ·
D14 `seed:demo-sales` · D15 no customer PII.

Four decisions refined during planning are in `00-DECISIONS.md`. Read it before Plan 01.

## Moving these files into the repo

Plan mode permits writes only under `/home/litcorp/.opencode/plan`. In a build session:

```bash
mkdir -p .planning/phases/09-analytics-dashboard/evidence
cp /home/litcorp/.opencode/plan/09-analytics-dashboard/*.md .planning/phases/09-analytics-dashboard/
```

`00-CONTEXT.md` already exists in the destination; do not overwrite it.

## Repository guardrails that apply to every plan

- Server is authoritative. No money, credit, stock, loyalty, or permission rule is decided
  client-side.
- Integer minor units everywhere. No float touches money; no helper divides by 100 except
  display formatting.
- Append-only ledgers are read, never written, by this phase. Phase 9 adds **no migration**.
- No secrets, tokens, PINs, or customer identity in logs or payloads.
- `bun run test`, not `bun test` (Bun resolves the latter to its builtin runner).
- Run `bun run lint`, `bun run check-types`, `bun run brand:check`, `bun run tokens:check`,
  and `bun run modules:check:strict` before declaring a plan done.
