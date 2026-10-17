---
phase: 01-foundation
plan: 03
subsystem: auth, identity, org, platform
tags: [better-auth, rbac, audit, seeds, argon2, totp, enrollment, settings]
requires:
  - 01-PLAN (workspace, shared, db, postgres)
  - 02-PLAN (api skeleton, org/platform schema, migration 0000)
provides:
  - Better Auth instance (email/password + TOTP, Argon2id, audit hooks)
  - Session, permission, freshness, and branch-scope middleware
  - Branch, terminal, enrollment, staff, audit, and settings APIs
  - Idempotent admin and demo seeds
  - Integration test harness on a dedicated gikautos_test database
affects:
  - 04-PLAN (admin console consumes these endpoints)
  - Phase 6 (enrollment redeem contract, PIN fields, PowerSync tokens)
tech-stack:
  added: [better-auth@1.7.10, "@better-auth/drizzle-adapter@1.7.10", "@node-rs/argon2@2.2.2", resend@6.34.1]
  patterns:
    - Deny-by-default permission middleware over shared ROLE_PERMISSIONS
    - Audit rows written in the same transaction as the mutation
    - Better Auth databaseHooks for auth-event auditing and fail-closed gates
    - Typed settings definitions with branch fallback
key-files:
  created:
    - api/src/auth/auth.ts
    - api/src/auth/hooks.ts
    - api/src/auth/password.ts
    - api/src/auth/sessions.ts
    - api/src/email/*
    - api/src/http/session.ts
    - api/src/http/authorize.ts
    - api/src/http/validation.ts
    - api/src/http/rate-limit.ts
    - api/src/modules/org/*
    - api/src/modules/identity/*
    - api/src/modules/platform/*
    - api/src/routes/auth.ts
    - packages/db/src/schema/auth.ts
    - packages/db/src/seed/*
  modified:
    - api/src/app.ts
    - api/src/config/env.ts
    - api/src/http/factory.ts
    - api/src/http/request-id.ts
    - packages/db/src/schema/index.ts
    - packages/shared/src/permissions.ts
    - api/test/setup.ts
    - api/vitest.config.ts
decisions:
  - Session freshness is measured from session.createdAt (Better Auth semantics)
  - Public sign-up is blocked at the route level; autoSignIn disabled; staff are admin-created
  - branch.deactivate is an admin-only permission
  - Enrollment codes are HMAC-SHA256 hashed with the auth secret; one live code per terminal
  - Auth events are audited via databaseHooks; domain mutations audit inside transactions
metrics:
  duration: session 2026-10-17
  completed: 2026-10-17
---

# Phase 1 Plan 03: Auth, RBAC, Organisation, Audit, Seeds — Summary

Argon2id + TOTP authentication with deny-by-default RBAC and branch scoping, organisation and staff APIs, an append-only audit trail, typed settings, and idempotent seeds — 79 API tests green against a real Postgres test database.

## What Was Built

### Task 1 — Email provider seam (`6fcc817`)
`EmailProvider` interface with a console adapter (recipients redacted, bodies never
logged) and a Resend adapter selected at boot when `RESEND_API_KEY` is set. Boot
logs an error if production runs without a key.

### Task 2 — Better Auth instance (`efb99a7`, `d6d6991`)
- Argon2id (64 MiB, t=3, p=4, 32-byte) custom hash/verify.
- Sessions: 7-day sliding, `updateAge` 24 h, `freshAge` 1 h, 5-minute compact cookie
  cache; secure cookies and rate limiting enabled in production, with stricter rules
  for sign-in, reset, and 2FA paths.
- TOTP two-factor plugin (`issuer: GikAutos`).
- `databaseHooks`: audit rows for user/session/account events; session creation
  refuses deactivated accounts (fail-closed).
- Drizzle adapter with `transaction: true`; public sign-up route returns 404;
  `POST /api/auth/*` otherwise served by `auth.handler`.
- Auth schema generated with `bunx auth@1.7.10 generate` into
  `packages/db/src/schema/auth.ts`, hardened (not-null defaults, `branch_id` uuid FK
  to `branch`, snake_case index names), migration `0001` applied.

### Task 3 — Middleware (`a1bb9db`)
`loadSession` (never throws), `requireSession` (401/403, inactive accounts rejected,
`mustChangePassword` locks every route except `POST /api/me/password`),
`requireFreshSession` (createdAt-based, `REAUTH_REQUIRED`), and
`requirePermission`/`branchScope`/`assertBranchAccess`/`resolveBranchFilter`
(deny by default, unknown roles fail closed).

### Task 4 — Branch API (`856c6f4`)
CRUD with code validation/normalization, `409` on duplicates, admin-only
deactivation, manager-limited fields, `suggest-code`, audit rows in the same
transaction. Added `branch.deactivate` (admin-only) to shared permissions.

### Task 5 — Terminals and enrollment (`5ef8ba6`)
Per-branch `<CODE>-Tnn` allocation with retry, one-time 8-character enrollment
codes (human-typable alphabet, HMAC-hashed at rest, 15-minute expiry, one live code
per terminal), device listing/revocation, and the Phase 6 `redeem` contract that
consumes the code and returns `501 NOT_IMPLEMENTED`, rate limited per IP.

### Task 6 — Staff management (`2f8a783`)
Admin any-role creation; managers create managers/cashiers in their own branch.
Staff IDs allocated atomically from the settings sequence (`GA-0001`). Temporary
passwords are returned once (rendered by the console, never logged) and emailed;
`mustChangePassword` is forced. Fresh-session password resets revoke target
sessions; deactivation blocks sign-in via the session hook; self-deactivation and
last-active-admin removal are rejected. `POST /api/me/password` clears
`mustChangePassword` and keeps only the current session.

### Task 7 — Audit and settings (`da8cabb`)
`GET /api/audit` paginated with actor/action/entity/branch/date filters;
managers scoped to their branch. `GET/PATCH /api/settings` with typed Zod
definitions, branch-scoped fallback (`receipt.header`), admin-only global keys,
and audited changes. Append-only guarantee enforced by module surface (`writeAudit`,
`queryAudit` only).

### Task 8 — Seeds (`ea6e64f`)
`seedAdmin` from `ADMIN_EMAIL`/`ADMIN_PASSWORD` (idempotent, no TOTP secret);
`seedDemo` (`--demo`, development only) with `ACC-SPX`, `ACC-WH1`, one terminal
each, manager + cashier with `mustChangePassword`, and settings defaults. Credential
rows are Argon2id hashes; staff IDs come from the settings sequence.

## Deviations from Plan

1. **[Rule 1 — Bug] Freshness uses `session.createdAt`.** The plan text said
   createdAt/updatedAt; Better Auth 1.7.10 measures freshness from `createdAt`, so
   the middleware matches to avoid rejecting mid-day sessions.
2. **[Rule 3 — Blocking] `disableSignUp` blocks server-side user creation.** Better
   Auth's sign-up route throws when sign-up is disabled, and staff must be created
   server-side. Kept sign-up enabled in config, set `autoSignIn: false` (no session
   on server-side creation), and blocked `POST /api/auth/sign-up/*` at the Hono
   layer with 404.
3. **[Rule 2 — Missing critical] `branch.deactivate` permission.** Deactivation was
   under `branch.update`, which managers hold; added an admin-only permission so
   managers cannot deactivate branches.
4. **[Rule 2 — Missing critical] Enrollment code hardening.** Codes are HMAC-SHA256
   keyed with `BETTER_AUTH_SECRET` (not plain SHA-256), only one live code per
   terminal exists, and redeem is rate limited (10/min/IP).
5. **[Rule 2 — Missing critical] Fresh session on `POST /api/me/password`.** Matches
   Better Auth's own change-password policy.
6. **[Rule 2 — Missing critical] Auth schema hardening.** `role`, `isActive`,
   `mustChangePassword`, `pinVersion` are NOT NULL with defaults; `branch_id` is a
   uuid FK to `branch` (on delete set null). Regenerating the file with the CLI will
   need these re-applied.
7. **[Rule 2 — Missing critical] Hash fields never returned.** `pinHash` and
   `pinVersion` use `returned: false`; staff queries select explicit columns.
8. **[Rule 3 — Blocking] Tests need a database.** `api/test/setup.ts` now targets
   `gikautos_test` (override with `TEST_DATABASE_URL`); added `bun run
   db:test:prepare` to create and migrate it; vitest runs files serially so
   last-admin assertions are deterministic.
9. **[Rule 3 — Blocking] Better Auth IDs are not UUIDs.** Staff `:id` params accept
   opaque 1–64 character ids; branch/terminal/device ids remain UUIDs.
10. **[Rule 2 — Missing critical] Adapter transactions.** `drizzleAdapter(..., {
    transaction: true })` so multi-write auth operations are atomic.
11. **Seeds write auth tables directly.** `packages/db` cannot import the API's
    Better Auth instance; the seed hashes with identical Argon2id parameters and
    inserts user + credential account rows.
12. **Temp passwords are returned once in API responses** rather than logged; the
    console provider intentionally does not log email bodies.

## Verification

- `bun run lint` — clean (102 files).
- `bun run check-types` — clean (api, admin, shared, db).
- `bun run test` — shared 13/13, api 79/79 (integration tests live against
  `gikautos_test`; 9 suites + middleware/unit suites).
- `bunx auth@1.7.10 check schema --config api/src/auth/auth.ts` — passes.
- Live round trip on the dev database: seeded admin signs in (200, role ADMIN,
  `twoFactorEnabled: false`), `get-session` returns the staffId, `sign-out` 200.
- `bun run db:seed --demo` twice — idempotent ("already present" on re-run).

## Commits

| Hash | Message |
|---|---|
| 215a60e | chore(deps): add better-auth, drizzle adapter, argon2, and resend |
| 6fcc817 | feat(api): add console and resend email providers |
| efb99a7 | feat(db): add better auth schema with user, session, account, and two-factor tables |
| d6d6991 | feat(api): configure better auth with argon2, totp, and audit hooks |
| a1bb9db | feat(api): add session, permission, freshness, and branch scope middleware |
| 856c6f4 | feat(api): add branch management endpoints with audit |
| 5ef8ba6 | feat(api): add terminal registry and enrollment code endpoints |
| 2f8a783 | feat(api): add staff management with scoped permissions and audit |
| da8cabb | feat(api): add audit log and settings endpoints |
| ea6e64f | feat(db): add idempotent admin and demo seeds |

## Next Phase Readiness

- Plan 04 (admin console) can build against: `POST /api/auth/*`, `/api/branches`,
  `/api/terminals`, `/api/enrollments/redeem`, `/api/staff`, `/api/me/password`,
  `/api/audit`, `/api/settings`.
- Human verification still required: forced TOTP enrollment, manager scoping via
  direct URL attempts, enrollment code expiry/revocation behavior.
- `pinHash`/`pinVersion` placeholders await Phase 6; the enrollment `redeem`
  endpoint intentionally returns 501 until device tokens arrive with PowerSync.
