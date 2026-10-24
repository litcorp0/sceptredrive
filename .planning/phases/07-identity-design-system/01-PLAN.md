---
phase: 07-identity-design-system
plan: 01
wave: 1
title: Workspace and package-scope rename
requirements: [UIX-01]
depends_on: []
status: planned
created: 2026-10-24
---

# Plan 01 — Workspace and Package-Scope Rename

**Goal:** The repository, its workspaces, its packages, its database, and its documentation
are named Sceptre Drive, with no stale brand string outside the allowlist, and the entire
test suite still green.

**Scope:** This plan renames the **workspace and server-side** identity (package scope, root
package, Docker/Postgres, logger, JWT audience, docs). The desktop application identity
(protocol host, product name, CSP constants, window titles, Squirrel name) is Plan 02, so
each plan stays reviewable on its own.

## Task 1 — Package scope and root package

**Files:** `packages/shared/package.json`, `packages/db/package.json`,
`api/package.json`, `admin/package.json`, `desktop/package.json`, `package.json`,
`tsconfig.base.json`, `biome.json`, every importing `.ts`/`.tsx` file, `bun.lock`

- Rename `"@gikautos/shared"` → `"@sceptre/shared"` and `"@gikautos/db"` → `"@sceptre/db"`
  in both package manifests and every `workspace:*` dependency that references them.
- Rewrite every import specifier: `from '@gikautos/shared'` → `from '@sceptre/shared'`,
  `from '@gikautos/db'` → `from '@sceptre/db'`. Use a single `perl -pi -e` sweep, then
  `grep -rn '@gikautos' --include='*.ts' --include='*.tsx' --include='*.json'` to prove zero
  remain.
- Root `package.json`: `"name": "gikautos"` → `"name": "sceptre-drive"`. Leave
  `"packageManager": "bun@1.3.14"` untouched.
- Run `bun install` to relink the workspace and rewrite `bun.lock`. Confirm the lockfile has
  no `@gikautos` entry and that `node_modules/@sceptre/{shared,db}` are real symlinks.
- Do **not** touch `packages/shared/node_modules` or any `node_modules` content by hand.

**Verify:** `bun install` exits 0; `bun run --filter shared test` and
`bun run --filter api check-types` both resolve `@sceptre/*`; `grep -rn '@gikautos'` over
`*.ts`, `*.tsx`, `*.json` (excluding `node_modules`) returns nothing.

**Commit:** `chore(workspace): rename package scope to @sceptre`

## Task 2 — Server identity: Docker, Postgres, logging, tokens

**Files:** `compose.yaml`, `package.json` (db/sync scripts), `.env.example`,
`powersync/` config and docs, `api/src/logger.ts`, `api/src/modules/sync/sync.jwt.ts`,
`api/src/modules/sync/sync.jwt.test.ts` / `sync.test.ts`, `api/test/setup.ts`,
`api/src/seed/**`, `scripts/**`

- `compose.yaml`: project `gikautos-dev` → `sceptre-drive-dev`; containers
  `gikautos-postgres`/`gikautos-powersync` → `sceptre-drive-*`; `POSTGRES_USER`/
  `POSTGRES_PASSWORD`/`POSTGRES_DB` `gikautos` → `sceptre_drive`; PowerSync
  `PS_DATA_SOURCE_URI` and `PS_STORAGE_URI` databases → `sceptre_drive`,
  `sceptre_drive_powersync`; the healthcheck `pg_isready -U sceptre_drive -d sceptre_drive`.
- Root `package.json` scripts: `db:test:prepare` and `sync:init` use the new user/db/test db.
- `.env.example`: `DATABASE_URL`, `CORS_ORIGINS` (`app://sceptre-drive`), `ADMIN_EMAIL`,
  `DEMO_*_EMAIL`, `EMAIL_FROM` → `@sceptre.local`; add a comment above `DATABASE_URL` noting
  the Phase 7 rename requires a fresh dev database.
- `api/src/logger.ts`: `service: 'gikautos-api'` → `'sceptre-drive-api'`.
- `api/src/modules/sync/sync.jwt.ts`: `DEVICE_TOKEN_AUDIENCE = 'gikautos-pos'` →
  `'sceptre-pos'`, and update the doc comment. Update every test that asserts the audience.
- Seed data: seed user emails and any branch/terminal codes containing the old slug.
- **Local `.env`:** apply the same substitutions to the git-ignored `.env` on this machine
  so development keeps working. Never stage or print it.
- Recreate the dev database: `docker compose down -v && docker compose up -d`, then
  `bun run db:migrate`, `bun run sync:init`, `bun run db:seed`. Confirm the PowerSync service
  starts against the new source database.

**Verify:** `docker compose ps` shows both services healthy under the new names; `psql` can
connect as `sceptre_drive`; `bun run db:seed` completes idempotently; a device token minted
after the change carries `aud: sceptre-pos` and an old-audience token is rejected (asserted
in the JWT test); `bun run --filter api test` passes.

**Commit:** `chore(infra): rename database, containers, and service identity`

## Task 3 — Documentation and remaining references

**Files:** `AGENTS.md`, `README.md`, `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`,
`.planning/ROADMAP.md`, `.planning/config.json`, `api/README.md`, `admin/README.md`,
`desktop/README.md`, `.github/workflows/**`, `powersync/README.md`

- Title and prose: `GikAutos` → `Sceptre Drive`; `gikautos` → `sceptre-drive` where it is a
  slug. Keep the historical phase records (`phases/01..06/**`) untouched — they are the
  audit trail and are on the allowlist.
- `AGENTS.md`: update the project title, the stack table's workspace names, add
  `packages/brand` to the repository layout, add the new top-level `design-system/` folder
  with a one-line purpose ("human-facing design rationale; `packages/brand` is the machine
  truth"), and add a note that the product was renamed on 2026-10-24 with the code sweep
  complete.
- `.github/workflows`: GHCR image names, compose project names, and any database name.
- Do **not** rewrite `api/migrations/**`. Applied migration text is history; the database is
  recreated instead.
- Add a short `desktop/README.md` section titled "Renamed from GikAutos" documenting the
  re-enrolment and local-data consequences from CONTEXT D3.

**Verify:** the allowlist grep (next task) passes; `bun run lint` is clean.

**Commit:** `docs: rename the project to Sceptre Drive`

## Task 4 — The allowlist gate

**Files:** `scripts/check-brand.mjs`, root `package.json` (`brand:check` script),
`.github/workflows/checks.yml`

- Write `scripts/check-brand.mjs`: walks the repo, skips `node_modules`, `.git`, `.output`,
  `out`, `dist`, and fails on any case-insensitive `gikautos` match **except**:
  - `.planning/phases/01-*` … `.planning/phases/06-*` (historical records),
  - `scripts/check-brand.mjs` itself,
  - any file listed in an explicit `ALLOW` array — initially empty.
- Wire `"brand:check": "node scripts/check-brand.mjs"` and run it in the CI checks job after
  lint.
- The script prints `file:line: text` for every violation so a partial sweep is obvious.

**Verify:** `bun run brand:check` exits 0; temporarily inserting `gikautos` in a source file
makes it exit 1 with the expected path, then revert.

**Commit:** `chore(ci): fail the build on stale brand strings`

## Definition of Done

- `bun install`, `bun run lint`, `bun run check-types`, `bun test`, `bun run brand:check` all
  pass.
- API 354 and shared 73 tests still pass; no test was deleted or skipped to achieve it.
- The dev stack runs on the new database names with a fresh seed.
