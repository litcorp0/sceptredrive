---
phase: 04-customers-credit
plan: 05
wave: 4
title: pg-boss jobs infrastructure and the loyalty expiry schedule
requirements: [LOY-05]
depends_on: [04]
status: planned
created: 2026-10-18
---

# Plan 05 — Jobs Infrastructure and Loyalty Expiry Job

**Goal:** The API process runs pg-boss with the `loyalty-expiry` queue scheduled daily
(Africa/Accra, catch-up on missed runs), the worker calls the Plan 04 expiry function,
and admins can trigger a run on demand for operations and verification.

## Task 1 — Add pg-boss

**Files:** root `package.json` (catalog), `api/package.json`, lockfile

- Add `pg-boss` to the root catalog and `api` dependencies (`catalog:`), run
  `bun install`; confirm the installed major is 12.x and that the docs' Node support
  covers Node 24 (already checked against v12.38 docs; re-verify the release notes at
  install time). No hand-rolled queueing.

**Verify:** `bun run --filter api check-types`; a scratch script starts and stops a boss
against the dev DB (`boss.start()` → `boss.stop()`) and `\dn` shows the `pgboss` schema.
**Commit:** `chore(api): add pg-boss dependency`

## Task 2 — Jobs module, worker, and schedule

**Files:** `api/src/jobs/boss.ts`, `api/src/jobs/queues.ts`, `api/src/jobs/index.ts`,
`api/src/index.ts`, `api/src/config/env.ts` (only if a flag is needed)

- `boss.ts`: create the Boss instance from the existing env database connection
  (`connectionString`), with pino logging bridged through the existing logger; export
  `startBoss`/`stopBoss`.
- `queues.ts`: register `loyalty-expiry` as a queue and its worker → calls
  `loyalty.service.expireDueLots()` and logs the `{ accounts, lots, points }` summary;
  register the schedule on boot: `boss.schedule('loyalty-expiry', '5 0 * * *', null,
  { tz: 'Africa/Accra', missed: 'once' })` (pg-boss v12 docs: minute precision,
  catch-up semantics).
- `index.ts`: `startJobs()` after the HTTP server starts; `stopJobs()` first in the
  graceful shutdown path before `closeDb()`. Tests import `app.ts` directly and never
  start jobs.

**Verify:** dev server boot logs the queue/schedule; `psql` shows the schedule row in
`pgboss.schedule`; `boss.send('loyalty-expiry')` (or `INSERT`-free API) runs the worker
and the expiry summary line appears; SIGTERM shuts down cleanly.
**Commit:** `feat(api): add pg-boss jobs infrastructure and expiry schedule`

## Task 3 — Admin expiry trigger and job integration test

**Files:** `api/src/modules/loyalty/loyalty.routes.ts`,
`api/src/modules/loyalty/loyalty.controller.ts`,
`api/src/modules/loyalty/loyalty.test.ts`, `api/src/jobs/queues.ts`

- `POST /api/loyalty/expiry-run` — admin-only (gate `loyalty.settings`, the admin-only
  Phase 4 permission), calls the same `expireDueLots()` seam, returns the summary,
  audited. Used by operations and by the Plan 08 walkthrough.
- Integration test (test DB): start a boss instance, send one `loyalty-expiry` job,
  run a single worker, assert a due lot (inserted with a past `expires_at`) is expired
  and a re-run changes nothing; stop the boss. Use the pg-boss testing utilities if
  they fit better than real timers.

**Verify:** endpoint test: manager → 403, admin → 200 with summary; integration test
green; `bun run --filter api test` fully green.
**Commit:** `feat(api): add loyalty expiry trigger and job test`

## Done When

One API process runs a scheduled, catch-up-aware loyalty expiry job through pg-boss with
graceful shutdown, the same expiry function is callable by admins for operations, and
the code path is proven by an integration test against the test database.
