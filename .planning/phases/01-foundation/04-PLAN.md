---
phase: 01-foundation
plan: 04
wave: 4
title: Admin shell, auth flows, CRUD screens, CI, and phase verification
requirements: [FOUND-12, FOUND-13, FOUND-14, ADM-01, ADM-09]
depends_on: [03]
status: planned
created: 2026-10-17
---

# Plan 04 — Admin Console, CI, Verification

**Goal:** The admin/manager console signs users in (including forced TOTP setup), guards
routes, scopes navigation by role and branch, and manages branches, terminals, staff,
settings, and the audit log against the live API. CI is green and the phase is verified.

## Task 1 — Admin app foundations

**Files:** `admin/src/lib/api.ts`, `admin/src/lib/auth-client.ts`, `admin/src/env.ts`,
`admin/package.json`, `admin/vite.config.ts`

- `env.ts`: add `VITE_API_URL` (required in dev/prod builds).
- `auth-client.ts`: `createAuthClient({ baseURL: "${VITE_API_URL}/api/auth",
  plugins: [twoFactorClient({ onTwoFactorRedirect: () => router.navigate('/two-factor') })] })`.
- `api.ts`: typed fetch wrapper (`credentials: "include"`, JSON errors normalized,
  401 → redirect to login, `x-request-id` surfaced in error toasts).
- Ensure `better-auth` is a catalog dependency of admin; remove unused faker/devtools
  packages that shipped with the scaffold if they are not used.

**Verify:** `bun --filter admin check-types` passes; no unused deps remain.
**Commit:** `feat(admin): add api client, auth client, and env configuration`

## Task 2 — Auth pages and session guards

**Files:** `admin/src/routes/login.tsx`, `admin/src/routes/forgot-password.tsx`,
`admin/src/routes/reset-password.tsx`, `admin/src/routes/two-factor.tsx`,
`admin/src/routes/_authenticated/route.tsx`, `admin/src/lib/session.functions.ts`

- `session.functions.ts`: TanStack Start server function that forwards request cookies to
  `GET {API}/api/auth/get-session`; returns a typed session or null.
- `_authenticated` layout route `beforeLoad`: redirect anonymous users to `/login`;
  return the session in route context.
- Forced TOTP: if `user.role === "ADMIN" && !session.user.twoFactorEnabled` and the route
  is not `/two-factor`, redirect to `/two-factor?setup=1`.
- Login page: email/password, generic error, 2FA redirect handling, loading and disabled
  states, no account-enumeration messaging.
- Forgot/reset password pages wired to the auth client with absolute redirect URLs.
- 2FA page: TOTP setup (QR from `totpURI`, backup codes download) and verify flows.

**Verify:** manual: seeded admin signs in → forced TOTP setup → session established;
wrong password shows generic error; manager/2FA-optional user lands on the dashboard.
**Commit:** `feat(admin): add login, password reset, two-factor, and session guards`

## Task 3 — Console shell, navigation, and branch switcher

**Files:** `admin/src/routes/__root.tsx`, `admin/src/components/layout/app-shell.tsx`,
`admin/src/components/layout/sidebar.tsx`, `admin/src/components/layout/branch-switcher.tsx`,
`admin/src/components/layout/user-menu.tsx`, `admin/src/styles.css`

- Root document title `GikAutos Admin`, favicon/title metadata, theme tokens.
- App shell: fixed sidebar + content region with independent scroll, topbar with
  branch switcher (admin only; managers see their branch name), user menu
  (profile, change password, sign out), offline/API unreachable banner.
- Navigation is permission-aware via `ROLE_PERMISSIONS`: Dashboard, Branches, Terminals,
  Staff, Audit Log, Settings; exactly one active item; manager nav hides admin-only items.
- Active branch persists in memory/query state (React context); admin-only screens offer
  a branch filter.
- shadcn components added as needed (table, dialog, dropdown-menu, badge, card, tabs,
  sonner, alert-dialog, separator, skeleton).

**Verify:** mobile-accessible sidebar, keyboard focus states, no console errors; a manager
cannot see or open Branches/Staff admin-only sections.
**Commit:** `feat(admin): add permission-aware app shell and branch switcher`

## Task 4 — CRUD screens

**Files:** `admin/src/routes/_authenticated/branches.tsx`, `admin/src/routes/_authenticated/branches.$id.tsx`,
`admin/src/routes/_authenticated/terminals.tsx`, `admin/src/routes/_authenticated/staff.tsx`,
`admin/src/routes/_authenticated/audit.tsx`, `admin/src/routes/_authenticated/settings.tsx`,
`admin/src/components/**`

- **Branches:** list (code, name, type, city, active), create dialog with city/area fields
  and a suggested editable code (`suggest-code` endpoint), detail/edit, deactivate with
  confirmation. Manager sees only their branch (read-only fields per API rules).
- **Terminals:** list by branch, create (auto code preview), enrollment dialog that shows
  the one-time code with expiry and copy button, revoke/list devices.
- **Staff:** list with filters (role, branch, active), create (role/branch, temp password
  shown once), edit role/branch (admin), reset password, deactivate/reactivate; all
  guarded by permissions and fresh-session errors surface as a re-auth prompt.
- **Audit:** table with filters (actor, action, entity, date, branch), before/after diff
  viewer, pagination.
- **Settings:** staff ID prefix/sequence and other Phase 1 keys; branch-scoped keys for
  managers.
- All tables use TanStack Query with loading/empty/error states and debounced filters;
  mutations invalidate relevant queries and toast success/failure with the request ID.

**Verify:** every screen performs a real API round trip against local Postgres; actions
appear in the audit log; manager scope is enforced by the API even if a URL is typed.
**Commit:** `feat(admin): add branch, terminal, staff, audit, and settings screens`

## Task 5 — Continuous integration

**Files:** `.github/workflows/ci.yml`

- Trigger: PRs and pushes to `dev` and `staging`.
- Job: checkout, `oven-sh/setup-bun@v2` (1.3.14), Postgres 18 service with healthcheck,
  `bun install --frozen-lockfile`, `bun run lint`, `bun run check-types`, `bun run test`,
  `bun run build`, and `bun --filter @gikautos/db db:migrate`.
- Environment: test-only secrets, `NODE_ENV=test`, no external services.
- Optional: Trivy Docker scan is deferred to Phase 9; keep CI fast.

**Verify:** workflow passes on `dev`; a deliberately broken type fails the job locally
(`bun run check-types`) before pushing.
**Commit:** `ci: add lint, typecheck, test, migrate, and build workflow`

## Task 6 — Phase verification and state update

**Files:** `.planning/phases/01-foundation/01-VERIFICATION.md`, `.planning/STATE.md`, `.planning/ROADMAP.md`

- Run the five roadmap success criteria end to end against a fresh database:
  1. Admin creates branch + warehouse + terminal + manager + cashier.
  2. Manager is branch-scoped; cashier cannot access admin functions.
  3. Enrollment code generated, listed, revoked.
  4. Every mutation appears in the audit log.
  5. `lint`, `check-types`, `test`, `build` pass locally and in CI.
- Record evidence (test names, commands, screenshots optional) in the verification file.
- Mark Phase 1 complete in `STATE.md`; tick the phase in `ROADMAP.md`.

**Verify:** a human can reproduce each criterion from the runbook notes.
**Commit:** `docs(planning): verify phase 1 foundation and update state`

## Wave 4 Done When

All five Phase 1 success criteria are proven; CI is green on `dev`; the console is usable
by both admin and manager roles against the live API.

## Human Verification Required

1. Forced TOTP enrollment for the bootstrap admin (authenticator app).
2. Manager scoping across branches in the UI (attempt a direct URL to another branch).
3. Terminal enrollment code expiry and revocation behavior.
