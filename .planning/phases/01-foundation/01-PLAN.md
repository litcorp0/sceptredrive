---
phase: 01-foundation
plan: 01
wave: 1
title: Workspace, tooling, Postgres, shared and db packages
requirements: [FOUND-01, FOUND-02, FOUND-03]
depends_on: []
status: planned
created: 2026-10-17
---

# Plan 01 — Workspace Foundation

**Goal:** One Bun workspace installs cleanly; Biome and TypeScript are shared; a local
Postgres 18 container starts healthy with logical replication enabled; `packages/shared`
and `packages/db` exist with tests.

## Task 1 — Root workspace manifest

**Files:** `package.json`, `bunfig.toml`

- Root `package.json`: `private: true`, `packageManager: "bun@1.3.14"`, type module.
- `workspaces.packages`: `["admin", "api", "desktop", "packages/*"]`.
- `workspaces.catalog`: pin the shared versions from `00-CONTEXT.md` (typescript 6.0.2,
  zod 4.6.7, pino 10.4.0, pg 8.23.1, better-auth 1.7.10, drizzle-orm 0.45.4,
  drizzle-kit 0.31.11, hono 4.13.13, vitest 5.0.5, biome 2.4.5).
- Root scripts:
  - `db:up` / `db:down`: `docker compose up -d` / `down`
  - `dev:api`, `dev:admin`
  - `lint`: `biome check .`
  - `check-types`: `bun run --filter '*' check-types`
  - `test`: `bun run --filter '*' test` (no-op for workspaces without tests until added)
  - `build`: `bun run --filter '*' build`
- `bunfig.toml`: install linker stays default (hoisted) for Electron/tooling compatibility.
- Verify `bun run --filter` supports parallel; if not, add a minimal `concurrently` root devDep.

**Verify:** `bun install` resolves all workspaces; `bun pm ls` shows admin/api.
**Commit:** `chore(workspace): add root bun workspace manifest and catalogs`

## Task 2 — Shared TypeScript and Biome

**Files:** `tsconfig.base.json`, `biome.json`, `admin/biome.json`, `api/biome.json`, per-package tsconfig

- `tsconfig.base.json`: `strict`, `target ES2024`, `module ESNext`, `moduleResolution Bundler`,
  `verbatimModuleSyntax`, `noUncheckedIndexedAccess`, `skipLibCheck`, path aliases unused at root.
- Root `biome.json`: recommended rules, formatter (2-space, 100 width), organize imports,
  `files.includes` excluding `node_modules`, `dist`, `.output`, `.tanstack`, migrations.
- Admin `biome.json` becomes `{ "extends": "//" }` plus any local overrides; add the same to `api/`.
- Each workspace `tsconfig.json` extends the root base.

**Verify:** `bunx biome check .` runs clean or with only formatting fixes applied.
**Commit:** `chore(tooling): add shared tsconfig base and biome root configuration`

## Task 3 — Local Postgres 18

**Files:** `compose.yaml`

- Service `postgres`: image `postgres:18-alpine`, db/user/password `gikautos`,
  port `5432:5432`, named volume, healthcheck `pg_isready`.
- Command flags: `-c wal_level=logical -c max_replication_slots=10 -c max_wal_senders=10`
  (prepares Phase 6 PowerSync replication; harmless now).
- Optional `pgadmin`? No — keep lean.

**Verify:** `docker compose up -d` → healthy; `psql postgresql://gikautos:gikautos@localhost:5432/gikautos -c 'show wal_level'` → `logical`.
**Commit:** `chore(dev): add postgres 18 compose service with logical replication`

## Task 4 — `packages/shared`

**Files:** `packages/shared/package.json`, `tsconfig.json`, `src/index.ts`, `src/roles.ts`,
`src/permissions.ts`, `src/branch-code.ts`, `src/branch-code.test.ts`

- `roles.ts`: `ROLES = ['ADMIN','MANAGER','CASHIER']`, `Role` type, `BRANCH_TYPES`.
- `permissions.ts`: permission string union + `ROLE_PERMISSIONS: Record<Role, Permission[]>`;
  `can(role, permission)` helper. Phase 1 permissions: `branch.read|create|update`,
  `terminal.read|create|update|revoke`, `staff.read|create|update|reset-password`,
  `audit.read`, `settings.read|update`, `device.read|revoke`.
- `branch-code.ts`: `suggestBranchCode({ city, area, type })` — uppercase ASCII tokens,
  city 3 letters + area 3 letters (`ACC-SPX`), warehouse `CITY-WH<n>`; `normalizeCode` and
  `isValidCode` validators; collision handling is the caller's job (DB unique).
- Vitest tests for permissions and code suggestion edge cases (accents, short names, duplicates).

**Verify:** `bun --filter @gikautos/shared test` passes; `bun --filter @gikautos/shared check-types` passes.
**Commit:** `feat(shared): add roles, permissions, and branch code domain helpers`

## Task 5 — `packages/db` scaffold

**Files:** `packages/db/package.json`, `tsconfig.json`, `drizzle.config.ts`, `src/index.ts`,
`src/client.ts`, `src/schema/index.ts`, `src/env.ts`

- Dependencies: `drizzle-orm`, `pg`, `dotenv`; dev: `drizzle-kit`, `@types/pg`, `tsx`.
- `client.ts`: build a `pg.Pool` from `DATABASE_URL`, export `db = drizzle({ client: pool, schema })`,
  `closeDb()`, and `checkDb()` (`SELECT 1`).
- `drizzle.config.ts`: `dialect: "postgresql"`, `schema: "./src/schema/*.ts"`,
  `out: "./migrations"`, `dbCredentials.url` from env, `migrations.table` default.
- Schema index exports org/platform tables (added in Plan 02; empty export now).
- Scripts: `db:generate`, `db:migrate`, `db:studio`, `db:seed`, `check-types`, `test`.

**Verify:** `bun --filter @gikautos/db check-types` passes; `client.ts` connects when `db:up` is running.
**Commit:** `feat(db): add drizzle client, config, and migration scripts`

## Task 6 — Environment template and repo hygiene

**Files:** `.env.example`, `.gitignore`

- Add `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `STAFF_ID_PREFIX=GA`, `STAFF_ID_START=1`.
- Confirm `.gitignore` covers `.output`, `.tanstack`, `coverage`, `migrations` snapshots are tracked.
- Document the workspace commands in the root `package.json` scripts (no README yet).

**Verify:** `git status` shows no secrets or build output staged.
**Commit:** `chore(env): document bootstrap admin and staff id settings`

## Wave 1 Done When

`bun install` succeeds, `bun lint` and `bun check-types` pass, Postgres is healthy with
`wal_level=logical`, and the shared/db packages typecheck and test.
