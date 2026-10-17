---
phase: 01-foundation
plan: 02
wave: 2
title: API skeleton, configuration, logging, health, and first schema
requirements: [FOUND-04, FOUND-03, FOUND-11]
depends_on: [01]
status: planned
created: 2026-10-17
---

# Plan 02 — API Skeleton & Database

**Goal:** A Hono API on Node 24 boots with validated config, structured logs, security
headers, CORS, health/readiness endpoints, and a first Drizzle migration for org and
platform tables — proven by integration tests.

## Task 1 — API package setup

**Files:** `api/package.json`, `api/tsconfig.json`, `api/src/index.ts`

- Dependencies (catalog versions): `hono`, `@hono/node-server`, `@hono/zod-validator`,
  `zod`, `pino`, `dotenv`, `@gikautos/db`, `@gikautos/shared`.
- Dev: `tsx`, `vitest`, `@types/node`, `pino-pretty`.
- Scripts: `dev` (`tsx watch --env-file=../.env src/index.ts`), `build` (`tsc -p tsconfig.build.json`),
  `start` (`node dist/index.js`), `check-types`, `test`, `lint`.
- `index.ts`: create the server with `serve({ fetch: app.fetch, hostname: "0.0.0.0", port })`,
  wire `SIGTERM`/`SIGINT` graceful shutdown (`server.close`, `closeIdleConnections`,
  10 s hard deadline), close the DB pool on exit.

**Verify:** `bun --filter api dev` serves `GET /`; Ctrl+C exits cleanly with no open handles.
**Commit:** `feat(api): scaffold hono server with graceful shutdown`

## Task 2 — Environment configuration

**Files:** `api/src/config/env.ts`

- Zod schema for: `NODE_ENV`, `API_PORT`, `DATABASE_URL`, `BETTER_AUTH_SECRET` (min 32),
  `BETTER_AUTH_URL`, `BETTER_AUTH_TRUSTED_ORIGINS`, `CORS_ORIGINS`, `LOG_LEVEL`,
  `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `STAFF_ID_PREFIX`, `STAFF_ID_START`, email vars,
  PowerSync/Paystack/E-VAT vars (optional in Phase 1).
- Refuse to boot in production with placeholder secrets; fail closed with a readable message.
- Export a frozen `env` object; load `.env` from the repo root with dotenv.

**Verify:** unit tests cover missing/placeholder/valid configs.
**Commit:** `feat(api): add validated environment configuration`

## Task 3 — Logging, request IDs, errors, headers, CORS

**Files:** `api/src/logger.ts`, `api/src/http/request-id.ts`, `api/src/http/logger.ts`,
`api/src/http/errors.ts`, `api/src/http/security-headers.ts`, `api/src/app.ts`

- pino logger with redaction paths (`req.headers.authorization`, `req.headers.cookie`,
  `res.headers["set-cookie"]`, `password`, `pin`, `secret`, `token`), pretty transport in dev.
- Request ID middleware (`crypto.randomUUID`) stored in context and echoed as `x-request-id`.
- Access log per request: method, path, status, duration, request id, no query strings with PII.
- Central `onError`: log with request id, return `{ error: { message, requestId } }`;
  never leak stack traces or internals; 4xx passthrough, 5xx generic.
- `notFound` handler returns JSON.
- Security headers middleware (CSP for API JSON, `x-content-type-options: nosniff`,
  `x-frame-options: DENY`, `referrer-policy`, `permissions-policy`, HSTS in production).
- CORS: explicit origins from `CORS_ORIGINS`, `credentials: true`, allow
  `content-type` and `x-request-id`, max age; reject others.

**Verify:** integration tests assert headers, CORS behavior for allowed/denied origins,
request id echo, and generic 500 body.
**Commit:** `feat(api): add logging, request ids, error handling, headers, and cors`

## Task 4 — Health and readiness

**Files:** `api/src/routes/health.ts`

- `GET /health` — liveness, no DB dependency: `{ status: "ok", version, uptime }`.
- `GET /ready` — runs `checkDb()` and returns 200 or 503 with a generic body.
- Register before body-consuming middleware.

**Verify:** `curl localhost:4000/health` and `/ready` (with and without Postgres running).
**Commit:** `feat(api): add health and readiness endpoints`

## Task 5 — Org and platform schema + first migration

**Files:** `packages/db/src/schema/org.ts`, `packages/db/src/schema/platform.ts`,
`packages/db/src/schema/index.ts`, `packages/db/migrations/*`

- `branch`: `id` uuid pk default gen_random_uuid, `code` text unique, `name`, `type` enum
  (`RETAIL`/`WAREHOUSE`), `city`, `area`, `address`, `phone`, `is_active`, timestamps,
  `created_by` text.
- `terminal`: `id`, `branch_id` fk → branch, `code` unique, `name`, `is_active`,
  `last_seen_at`, timestamps; unique `(branch_id, code)`.
- `device`: `id`, `terminal_id` fk, `fingerprint`, `token_hash` unique, `status` enum
  (`ACTIVE`/`REVOKED`), `enrolled_at`, `revoked_at`, `revoked_by`, `last_seen_at`.
- `terminal_enrollment`: `id`, `terminal_id` fk, `code_hash` unique, `expires_at`,
  `used_at`, `created_by`, `created_at`.
- `audit_log`: `id`, `actor_id`, `actor_staff_id`, `action`, `entity`, `entity_id`,
  `before` jsonb, `after` jsonb, `branch_id`, `terminal_id`, `ip`, `user_agent`,
  `request_id`, `created_at`; index `(entity, entity_id)`, `(branch_id, created_at)`.
- `setting`: `key`, `value` jsonb, `branch_id` nullable, `updated_by`, `updated_at`;
  `UNIQUE NULLS NOT DISTINCT (branch_id, key)` (Postgres 15+).
- Add pgcrypto or use `gen_random_uuid()` (built-in on PG 13+).
- Generate and apply the migration.

**Verify:** `bun --filter @gikautos/db db:generate && db:migrate`; `psql \dt` lists tables;
`audit_log` has no update path in code.
**Commit:** `feat(db): add org, terminal, device, audit, and settings schema`

## Task 6 — API test harness

**Files:** `api/vitest.config.ts`, `api/src/app.test.ts`, `api/test/setup.ts`

- Vitest with `app.request()` integration tests (no live server).
- Test env is injected before importing the app; no network calls.
- Cover: health, ready (mock DB failure), security headers, CORS, 404 shape, error shape.

**Verify:** `bun --filter api test` passes; `bun --filter api check-types` passes.
**Commit:** `test(api): add integration test harness and skeleton tests`

## Wave 2 Done When

The API boots with validated config, logs JSON with request IDs, returns correct
health/readiness, and the first migration applies cleanly to local Postgres.
