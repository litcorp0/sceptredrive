---
phase: 01-foundation
plan: 04
title: Phase 1 verification — Foundation & Platform
status: verified
verified: 2026-10-18
verifier: agent (with human steps outstanding, see bottom)
---

# Phase 1 — Foundation & Platform — Verification

**Goal proven:** a clean monorepo runs end to end. Admin and manager sign in; the
organisation (branches, warehouses, terminals, staff) exists; permissions and audit are
enforced; lint, typecheck, tests, and build pass.

**Environment:** dev database dropped and recreated (`gikautos`), migrations applied,
`db:seed` + `db:seed --demo` run, API (`:4000`) and admin (`:3000`) running locally.
Verification scripts drive the same HTTP endpoints the console uses.

## Success criteria

### 1. Admin creates branch, warehouse, terminal, manager, cashier — PASS

`phase-verify.mjs` (fresh DB): admin signs in → creates `TAM-KSI` (retail), `TAM-WH1`
(warehouse), terminal `TAM-KSI-T01` (code allocated server-side), manager `GA-0004`
(temporary password, `mustChangePassword: true`), cashier. All responses 201 with
audited rows.

### 2. Manager branch-scoped; cashier cannot reach admin functions — PASS

- Manager lists branches → exactly their branch; creating a branch → 403; reading
  another branch → 403; staff list contains only their branch's staff.
- Cashier (POS account) → 403 on `/api/branches`, `/api/terminals`, `/api/staff`,
  `/api/audit`, `/api/settings` (zero permissions).
- Manager cannot change global settings (403) or change roles/branches (403).
- Every endpoint is permission-checked server-side (`requirePermission`), proven by the
  403s above; console guards are UX only.

### 3. Enrollment code generated, listed, revoked — PASS (Phase 6 contract noted)

- Code generated: 8 characters, 15-minute expiry (`WUJSCMH4`).
- `POST /api/enrollments/redeem` validates and consumes the code, then returns the
  Phase 6 contract (`501 NOT_IMPLEMENTED`) — device tokens arrive with PowerSync.
- Generating a new code expires the previous one: redeeming the superseded code → 400.
- Devices listed per terminal (`/api/terminals/:id/devices`, empty before Phase 6) and
  revocation endpoint is in place (`/api/devices/:id/revoke`, covered by Plan 03 tests).
- One live code per terminal; codes are HMAC-hashed at rest (Plan 03).

### 4. Every mutation appears in the audit log — PASS

Audit query after the run contains: `branch.created` (2), `terminal.created`,
`staff.created` (2), `terminal.enrollment.created`, `auth.session.created`,
`auth.password.changed`. Entries carry actor (`actorId`, `actorStaffId: GA-0001`),
entity, entityId, branchId where applicable, requestId, and timestamp. The audit log is
append-only (no update/delete helpers; enforced by module surface and tested).

### 5. Lint, typecheck, tests, build pass locally and in CI — PASS (local); CI run deferred

- `bun run lint` — clean (173 files, Biome 2).
- `bun run check-types` — clean (api, admin, shared, db).
- `bun run test` — shared 13/13, api 83/83 against `gikautos_test`.
- `bun run build` — admin (Nitro) build succeeds; the built server boots and serves
  `/login` with HTTP 200.
- `.github/workflows/ci.yml` — validated with `actionlint` 1.7.12; the full CI command
  sequence (frozen install → lint → typecheck → migrate → test → build) executed
  locally against Postgres 18. A deliberately broken type fails `check-types` (probed).
- **Deferred:** no git remote exists yet, so the workflow has not run on GitHub. The
  remote push is tracked in STATE open items.

## UI verification (SSR + live API)

- **auth flows (26/26, `auth-e2e.mjs`):** admin sign-in; wrong password → generic 401;
  forced password change (manager temp password, API locked to `/api/me/password` until
  changed); forced TOTP setup for admins (enable → QR + 10 backup codes → verify);
  re-login challenged with `twoFactorRedirect`; wrong TOTP rejected; correct TOTP
  establishes the session; deactivated accounts blocked.
- **console shell (14/14, `ui-check.mjs`):** permission-aware sidebar; branch switcher;
  dashboard renders; all screens render for a manager; change-password renders
  standalone; anonymous visits redirect to `/login`.
- **CRUD round trips (20/20, `crud-check.mjs`):** terminal + enrollment + settings
  round trips; audit `actorStaffId` filter; every screen renders; manager restriction
  403s.

## Bugs found and fixed during verification

1. **Session cookie cache staleness (fixed, `2a139d1`).** `loadSession` trusted Better
   Auth's 5-minute signed cookie cache, so after `changeOwnPassword` (a direct DB
   update) users stayed locked out with "A password change is required" for up to five
   minutes. `loadSession` now always reads fresh (`disableCookieCache: true`); a
   regression test proves the lock clears immediately and fails without the fix.
2. **Build required `NODE_ENV=production`.** The SSR bundle mixed the dev JSX runtime
   when built without it; `admin`'s build script now sets it explicitly.
3. **Dual React in SSR.** Symlinked deps (sonner) resolved a second React copy from the
   Bun store; fixed with `resolve.dedupe` + `ssr.noExternal: ["sonner"]`.

## Deviations from the plan

1. `actorStaffId` filter added to `GET /api/audit` (the console filters by staff ID,
   not opaque user ID) — validation, types, repository, controller, and a test.
2. Dev email file transport (agreed decision): console provider writes to `api/.mail/`
   in development; tokens never reach logs.
3. `/change-password` renders standalone (outside the console shell) while
   `mustChangePassword` is pending.
4. Route stubs for the five screens were created in Task 4 so typed navigation links
   resolve; Task 5 replaced them with real screens.
5. `next-themes` removed from the shadcn sonner component (no dark mode in Phase 1).
6. Pagination reset uses React derived state instead of an effect (Biome
   `useExhaustiveDependencies`).

## Human verification outstanding

1. Forced TOTP enrollment with a real authenticator app (seeded admin), including the
   backup-codes download.
2. First-login forced password change through the console UI (demo manager/cashier).
3. Manager scoping in the browser: direct URL attempts to other branches/screens.
4. Password reset end to end via `api/.mail/` (forgot → reset → sign in).
5. Enrollment dialog behaviour: expiry countdown, regenerate, copy.
