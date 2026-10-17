---
phase: 01-foundation
plan: 03
wave: 3
title: Auth, RBAC, organisation APIs, audit, and seeds
requirements: [FOUND-05, FOUND-06, FOUND-07, FOUND-08, FOUND-09, FOUND-10, FOUND-11, FOUND-14]
depends_on: [02]
status: planned
created: 2026-10-17
---

# Plan 03 — Auth, RBAC, Organisation, Audit, Seeds

**Goal:** Admin/manager accounts sign in with email/password + TOTP; permissions and
branch scope are enforced server-side; branches, terminals, enrollment codes, and staff
are manageable through the API with audit entries; seeds bootstrap the admin and demo data.

## Task 1 — Email provider seam

**Files:** `api/src/email/types.ts`, `api/src/email/console.ts`, `api/src/email/resend.ts`,
`api/src/email/index.ts`

- `EmailProvider.send({ to, subject, text, html })`.
- Console provider logs the subject and recipient (dev only; note PII handling).
- Resend provider activates when `RESEND_API_KEY` is set; logs and rethrows on failure.
- Selected once at boot; exported as `email`.

**Verify:** unit test selects console without a key and Resend with one; no secrets logged.
**Commit:** `feat(api): add console and resend email providers`

## Task 2 — Better Auth instance

**Files:** `api/src/auth/auth.ts`, `api/src/auth/hooks.ts`, `packages/db/src/schema/auth.ts` (generated)

- `betterAuth` with: `drizzleAdapter(db, { provider: "pg" })`, `baseURL`, `secret`,
  `trustedOrigins`, `emailAndPassword: { enabled: true, minPasswordLength: 12,
  revokeSessionsOnPasswordReset: true, sendResetPassword }`,
  `session: { expiresIn: 7d, updateAge: 24h, freshAge: 1h, cookieCache: { maxAge: 300,
  strategy: "compact" } }`, `rateLimit` with a stricter rule for sign-in,
  `advanced.useSecureCookies` in production, `databaseHooks` for audit events,
  and the `twoFactor({ issuer: "GikAutos" })` plugin last.
- Argon2id custom `hash`/`verify` via `@node-rs/argon2` (64 MiB, t=3, p=4, 32-byte output).
- Additional user fields: `role`, `branchId`, `staffId` (unique), `phone`, `isActive`,
  `mustChangePassword`, `pinHash`, `pinVersion`.
- Generate the auth schema with the Better Auth CLI, merge it into
  `packages/db/src/schema/auth.ts`, generate and apply a migration.
- Audit hooks: session created/revoked, user created/updated, account linked; write
  `audit_log` rows with actor, IP, user agent, and request ID.

**Verify:** `bunx auth@latest check schema` passes; `GET /api/auth/ok` returns ok;
sign-in/out round trip works against the seeded admin (seed in Task 8).
**Commit:** `feat(api): configure better auth with argon2, totp, and audit hooks`

## Task 3 — Session and authorization middleware

**Files:** `api/src/http/session.ts`, `api/src/http/authorize.ts`, `api/src/http/factory.ts`

- `createFactory` with shared `Variables`: `requestId`, `logger`, `session`, `user`.
- Session middleware: `auth.api.getSession({ headers: c.req.raw.headers })`; never throws.
- `requireSession`: deny by default; 401 when absent; 403 when the account is inactive
  or `mustChangePassword` blocks the route (except password change and sign-out).
- `requirePermission(permission)`: checks `ROLE_PERMISSIONS` via `can()`; deny by default.
- `requireFreshSession`: for sensitive mutations; compares `session.createdAt`/`updatedAt`
  within `freshAge` and returns 403 `{ code: "REAUTH_REQUIRED" }` otherwise.
- `branchScope(user)`: returns `null` for admins, `user.branchId` for managers; helpers
  `assertBranchAccess(user, branchId)` and `resolveBranchFilter(user, queryBranchId)`.

**Verify:** unit tests for each middleware (missing session, wrong role, cross-branch,
stale session, inactive user).
**Commit:** `feat(api): add session, permission, freshness, and branch scope middleware`

## Task 4 — Branch API

**Files:** `api/src/modules/org/branches.routes.ts`, `api/src/modules/org/branches.service.ts`

- `GET /api/branches` — admin sees all; manager only own (branch filter applied).
- `POST /api/branches` — admin only; validates code with `isValidCode`; the request may
  carry the suggested code from the admin UI; unique violation returns 409.
- `GET /api/branches/:id`, `PATCH /api/branches/:id` (admin any; manager own, limited
  fields: name, address, phone), `POST /api/branches/:id/deactivate`.
- `GET /api/branches/suggest-code?city=&area=&type=` — returns a suggestion (authenticated).
- Every mutation writes an audit row with before/after.

**Verify:** integration tests: create branch, duplicate code 409, manager list scoped,
manager cannot update another branch, audit rows written.
**Commit:** `feat(api): add branch management endpoints with audit`

## Task 5 — Terminal and device enrollment API

**Files:** `api/src/modules/org/terminals.routes.ts`, `api/src/modules/org/terminals.service.ts`,
`api/src/modules/org/enrollment.service.ts`

- Terminal code auto-generated as `<branchCode>-T<n>` (next sequence per branch).
- `POST /api/terminals` (admin any branch; manager own branch), `GET`,
  `PATCH /api/terminals/:id` (rename, activate/deactivate).
- `POST /api/terminals/:id/enrollment` — creates a one-time code (8 chars, human-typable),
  stores only its hash, expires in 15 minutes; returns the plaintext code once.
- `POST /api/enrollments/redeem` — placeholder contract for Phase 6: validates the code,
  marks it used, and returns 501 `NOT_IMPLEMENTED` in Phase 1 (device tokens arrive with
  PowerSync in Phase 6). Documented in the plan so the POS contract is stable.
- `GET /api/terminals/:id/devices`, `POST /api/devices/:id/revoke` — admin any; manager own.
- Audit all mutations.

**Verify:** integration tests: code format, hash stored (not plaintext), expiry, reuse
rejected, manager scope, revoke audit.
**Commit:** `feat(api): add terminal registry and enrollment code endpoints`

## Task 6 — Staff management API

**Files:** `api/src/modules/identity/staff.routes.ts`, `api/src/modules/identity/staff.service.ts`

- Create staff (admin: any role/branch; manager: cashier/manager within own branch only;
  only admin can create admins): sets `staffId` (sequential `GA-0001` from settings),
  temporary password, `mustChangePassword: true`; sends an invitation email via the
  provider (console in dev).
- List staff (admin all, manager branch-scoped) with role/branch filters and pagination.
- `PATCH /api/staff/:id` — role/branch changes (admin only), name/phone (manager own branch).
- `POST /api/staff/:id/reset-password` — admin any; manager own branch cashiers; requires
  fresh session; revokes the target's sessions.
- `POST /api/staff/:id/deactivate` / `reactivate` — admin any; manager own branch
  cashiers; cannot deactivate self; cannot deactivate the last admin.
- Password change endpoint for the signed-in user (`mustChangePassword` aware).
- Audit every mutation (actor, target, before/after without secrets).

**Verify:** integration tests: staffId sequence, manager scope, last-admin protection,
fresh-session requirement, deactivation revokes sessions, no password in audit.
**Commit:** `feat(api): add staff management with scoped permissions and audit`

## Task 7 — Audit log and settings APIs

**Files:** `api/src/modules/platform/audit.routes.ts`, `api/src/modules/platform/settings.routes.ts`,
`api/src/modules/platform/audit.service.ts`

- `audit(entry)` service used by all modules; `audit_log` is append-only (no update/delete
  methods exported).
- `GET /api/audit` — paginated, filters: actor, action, entity, entityId, branch, date
  range; admin all; manager own branch.
- Settings: `GET /api/settings` (global + branch, manager sees own branch + global),
  `PATCH /api/settings` (admin global; manager branch-scoped keys only), typed keys with
  Zod schemas (staff ID sequence, loyalty defaults placeholder, receipt header).
- Mutations audit before/after; secrets are never stored in settings.

**Verify:** integration tests for pagination/filters, branch scope, settings validation,
and append-only guarantees.
**Commit:** `feat(api): add audit log and settings endpoints`

## Task 8 — Seeds (bootstrap admin + demo data)

**Files:** `packages/db/src/seed/admin.ts`, `packages/db/src/seed/demo.ts`, `packages/db/src/seed/index.ts`

- Admin seed (idempotent): creates the admin from `ADMIN_EMAIL`/`ADMIN_PASSWORD` if absent;
  role `ADMIN`, no branch; no TOTP secret (forced setup on first login).
- Demo seed (dev only, `NODE_ENV !== "production"` and an explicit `--demo` flag):
  retail branch `ACC-SPX`, warehouse `ACC-WH1`, terminals `ACC-SPX-T01` and `ACC-WH1-T01`,
  a manager (${DEMO_MANAGER_EMAIL or manager@gikautos.local}), a cashier
  (cashier@gikautos.local) with `mustChangePassword`, and global settings defaults.
  Product/catalog demo data arrives in Phase 2.
- `bun --filter @gikautos/db db:seed` runs admin seed; `db:seed --demo` adds demo data.
- Never print passwords in production logs.

**Verify:** re-running seeds is idempotent; admin can sign in; demo users exist with the
right roles and branches.
**Commit:** `feat(db): add idempotent admin and demo seeds`

## Wave 3 Done When

The seeded admin signs in and is forced into TOTP setup; a manager is branch-scoped;
terminals and enrollment codes work; staff management is permission-checked and audited;
audit and settings endpoints return scoped, paginated data.
