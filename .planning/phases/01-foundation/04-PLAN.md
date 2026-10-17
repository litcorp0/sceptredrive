---
phase: 01-foundation
plan: 04
wave: 4
title: Admin shell, auth flows, CRUD screens, CI, and phase verification
requirements: [FOUND-12, FOUND-13, FOUND-14, ADM-01, ADM-09]
depends_on: [03]
status: planned
created: 2026-10-17
updated: 2026-10-17
---

# Plan 04 — Admin Console, CI, Verification

**Goal:** The admin/manager console signs users in (forced password change, forced TOTP
setup for admins), guards routes, scopes navigation by role and branch, and manages
branches, terminals, staff, settings, and the audit log against the live API. CI is
defined and verified locally (no git remote exists yet); the phase is verified.

## Research deltas (verified 2026-10-17, before this refresh)

- **Better Auth 1.7.10 (installed):** `twoFactor.enable({ password })` returns
  `{ method, totpURI, backupCodes }`; `twoFactorEnabled` stays `false` until
  `twoFactor.verifyTotp({ code })` succeeds. Sign-in responses carry
  `twoFactorRedirect` and `twoFactorMethods`; handle it in the login page's
  `onSuccess`, not via a global router callback (avoids an auth-client ↔ router
  import cycle). Repeated failed verifications return 429
  `ACCOUNT_TEMPORARILY_LOCKED`. QR must be rendered locally (no third-party QR
  service) — use `react-qr-code@2.2.0` (verified current).
- **Better Auth client in a separate workspace:** admin cannot import `typeof auth`
  from `api/`; use the manual `inferAdditionalFields({ user: { ... } })` form for
  `role`, `branchId`, `staffId`, `phone`, `isActive`, `mustChangePassword`,
  `twoFactorEnabled`.
- **TanStack Start 1.169.3 (installed):** `.validator()` is the current API (verified
  in `node_modules`), server functions are same-origin RPC, CSRF middleware is
  auto-installed because there is no `src/start.ts` (do not add one without adding
  `createCsrfMiddleware` explicitly). Server utilities come from
  `@tanstack/react-start/server` (`getRequestHeader`, etc.).
- **mustChangePassword is an API hard-lock (found during refresh):** every API route
  except `POST /api/me/password` returns 403 while `mustChangePassword` is set. The
  console MUST force a change-password screen after first login; `authClient`'s own
  `changePassword` would not clear the flag, so the console uses our endpoint.
- **shadcn/ui (2026):** Base UI is now the default for new projects, but Radix is
  fully supported and `new-york` is still served. The scaffold already uses
  `radix-ui` + `new-york`; stay on it — do not migrate mid-project.
- **Vite env loading:** Vite only reads `.env` from the workspace root (`admin/`).
  Set `envDir` to the repo root so `VITE_API_URL` from the root `.env` is picked up.
- **CI actions:** `actions/checkout@v7` and `oven-sh/setup-bun@v2` are current;
  `setup-bun@v2` reads `packageManager` from `package.json` automatically.
- **No git remote exists** (`git remote -v` is empty; no `gh` CLI). CI "green on
  `dev`" can only be proven locally for now; pushing is a deferred step recorded in
  STATE.

## Task 1 — Admin app foundations

**Files:** `admin/src/env.ts`, `admin/src/lib/auth-client.ts`, `admin/src/lib/api.ts`,
`admin/src/lib/api-types.ts`, `admin/vite.config.ts`, `admin/package.json`

- `vite.config.ts`: `envDir: resolve(__dirname, '..')` so the repo-root `.env` feeds
  `import.meta.env` in dev, build, and SSR.
- `env.ts`: require `VITE_API_URL` (URL, non-empty); keep `VITE_APP_TITLE` optional;
  drop `SERVER_URL` if nothing uses it.
- `auth-client.ts`: `createAuthClient({ baseURL: `${env.VITE_API_URL}/api/auth`,
  plugins: [inferAdditionalFields({ user: { role: {type:'string'}, branchId:
  {type:'string'}, staffId: {type:'string'}, phone: {type:'string'}, isActive:
  {type:'boolean'}, mustChangePassword: {type:'boolean'}, twoFactorEnabled:
  {type:'boolean'} } }), twoFactorClient()] })`. No router callback in the plugin.
- `api.ts`: `ApiError { status, code, message, requestId }`; fetch wrapper with
  `credentials: 'include'`, JSON body handling, error envelope parsing
  (`{ error: { message, code, requestId } }`), `x-request-id` fallback from response
  headers; 401 → redirect to `/login?redirect=...` (caller can opt out).
  `REAUTH_REQUIRED` (403) is surfaced to callers, not auto-handled.
- `api-types.ts`: minimal response interfaces mirroring the verified contracts:
  `Branch` (id, code, name, type, city, area, address, phone, isActive, createdAt),
  `Terminal` (id, branchId, code, name, isActive, lastSeenAt, createdAt),
  `Device` (id, terminalId, fingerprint, status, enrolledAt, revokedAt, lastSeenAt),
  `Staff` (id, name, email, role, branchId, staffId, phone, isActive,
  mustChangePassword, twoFactorEnabled, createdAt), `AuditEntry` (id, actorId,
  actorStaffId, action, entity, entityId, before, after, branchId, terminalId, ip,
  userAgent, requestId, createdAt), `ResolvedSetting` (key, value, branchScoped,
  source), `Enrollment { code, expiresAt }`, `SuggestCode { code, adjusted }`,
  list envelopes (`{ branches }`, `{ staff, total }`, `{ entries, total }`, …).
  Type drift is accepted for Phase 1; revisit a shared contracts package in Phase 2.
- `package.json`: add `"better-auth": "catalog:"` and `"react-qr-code": "^2.2.0"`;
  remove scaffold deps verified unused (`@faker-js/faker`,
  `@tanstack/match-sorter-utils`, `@tanstack/react-table` — grep imports first;
  keep devtools packages).

**Verify:** `bun --filter admin check-types` passes; `bunx shadcn@latest info --json`
still reports the Radix/new-york setup; no unused deps remain.
**Commit:** `feat(admin): add api client, auth client, and env configuration`

## Task 2 — Dev email file transport (API)

**Files:** `api/src/email/file.ts`, `api/src/email/index.ts`, `api/src/email/file.test.ts`,
`.gitignore`

- New `createFileEmailProvider(dir)` that writes each message as
  `<timestamp>-<random>.txt` (To / Subject / blank line / body) into a gitignored
  directory and logs only the file path and redacted recipient (never the body or
  token to logs).
- `email/index.ts` selection: `RESEND_API_KEY` → Resend; else `NODE_ENV ===
  'development'` → file provider at `api/.mail` (resolved from module path); else
  console provider.
- Test: provider writes a file to a temp dir with the expected content; redaction
  helper reuse unchanged.
- `.gitignore`: add `api/.mail/`.

**Verify:** `bun run test --filter api` (email suites); manual: request a password
reset in dev, find the message in `api/.mail/`, follow the link.
**Commit:** `feat(api): write development emails to a local mail folder`

## Task 3 — Auth pages and session guards

**Files:** `admin/src/lib/session.functions.ts`, `admin/src/routes/login.tsx`,
`admin/src/routes/forgot-password.tsx`, `admin/src/routes/reset-password.tsx`,
`admin/src/routes/two-factor.tsx`, `admin/src/routes/_authenticated/route.tsx`,
`admin/src/routes/_authenticated/change-password.tsx`,
`admin/src/components/auth/**`, delete `admin/src/routes/index.tsx`

- `session.functions.ts`: `getSession` server fn forwards the incoming cookie header
  to `GET {VITE_API_URL}/api/auth/get-session`; returns `{ session, user } | null`;
  never throws on network failure (treat as anonymous).
- `_authenticated/route.tsx` `beforeLoad`, in order:
  1. no session → `redirect('/login', { search: { redirect: location.href } })`;
  2. `mustChangePassword && pathname !== '/change-password'` →
     `redirect('/change-password')`;
  3. `role === 'ADMIN' && !twoFactorEnabled` → `redirect('/two-factor',
     { search: { setup: '1' } })`.
  Return `{ session }` in route context.
- `login.tsx`: email/password; `signIn.email` with `onSuccess` handling
  `twoFactorRedirect` → navigate `/two-factor` (carry `redirect`); otherwise
  `router.invalidate()` and go to `redirect ?? '/'`; generic error text only
  ("Invalid email or password"); loading/disabled states; `beforeLoad` redirects
  signed-in users away (to `/`, or `/two-factor?setup=1` for an unenrolled admin).
- `forgot-password.tsx`: `requestPasswordReset({ email, redirectTo:
  `${window.location.origin}/reset-password` })`; always shows the same
  "check your inbox" confirmation (no enumeration).
- `reset-password.tsx`: reads `?token=` via `validateSearch`; new password + confirm
  (min 12); `resetPassword({ newPassword, token })`; success → `/login`; invalid or
  expired token → error with a link back to forgot-password.
- `two-factor.tsx` (public route, dual mode, `validateSearch { setup?, redirect? }`):
  - session && !twoFactorEnabled → **setup**: password field → `twoFactor.enable`
    → render `totpURI` locally with `react-qr-code` + show `backupCodes` with
    copy/download (`.txt`) → 6-digit code → `verifyTotp` → invalidate → continue
    to `redirect ?? '/'`.
  - no session → **verify** (2FA challenge in flight): 6-digit code,
    "Remember this device for 30 days" checkbox (`trustDevice`, default off),
    backup-code fallback via `verifyBackupCode`; success → invalidate → continue;
    429 `ACCOUNT_TEMPORARILY_LOCKED` → clear lockout message; failure without a
    pending challenge → back to `/login`.
  - session && twoFactorEnabled → redirect `/`.
- `change-password.tsx`: current + new + confirm; calls `POST /api/me/password`
  through `api.ts` (this clears `mustChangePassword`; `authClient.changePassword`
  would not). Handles `REAUTH_REQUIRED` with a "sign in again" message; on success
  `router.invalidate()` and continue to `/`. Reachable both forced and from the
  user menu.

**Verify:** seeded admin signs in → forced TOTP setup (QR + backup codes) → session
established; wrong password shows the generic error; a manager with
`mustChangePassword` (demo seed) is forced to change it before anything else; wrong
TOTP code errors cleanly.
**Commit:** `feat(admin): add login, password reset, two-factor, and session guards`

## Task 4 — Console shell, navigation, and branch switcher

**Files:** `admin/src/routes/__root.tsx`, `admin/src/routes/_authenticated/index.tsx`,
`admin/src/components/layout/app-shell.tsx`, `sidebar.tsx`, `branch-switcher.tsx`,
`user-menu.tsx`, `admin/src/lib/branch-context.tsx`, `admin/src/styles.css`

- **Design direction (decided): dense neutral ops console.** Prune the scaffold's
  decorative CSS (gradients, Fraunces, glass/hero effects, sea/teal variables);
  keep the zinc shadcn tokens, set `--radius: 0.5rem`, keep Manrope for sans, base
  body with no background art. No dark-mode toggle in Phase 1 (tokens stay).
- `__root.tsx`: title `GikAutos Admin`, favicon, `<Toaster />` (sonner), devtools
  only in development, `headers: () => ({ 'Cache-Control': 'private, no-store' })`
  (if route-level `headers` is unavailable in 1.169, verify against the installed
  types and fall back to response headers on `_authenticated`).
- App shell: fixed sidebar (240px; `Sheet` on mobile) + topbar (branch switcher,
  user menu) + content region with independent scroll; compact density (topbar
  56px, table rows ~40px, tight form spacing).
- Navigation is permission-aware via `can()` from `@gikautos/shared` (add the
  workspace dep if not present): Dashboard (always), Branches (`branch.read`),
  Terminals (`terminal.read`), Staff (`staff.read`), Audit (`audit.read`),
  Settings (`settings.read`); one active item; admin-only actions hidden from
  managers.
- `branch-context.tsx`: `activeBranchId` + setter in React context, persisted to
  `localStorage` (`gikautos.admin.branchId`), validated against the branch list;
  admins get an "All branches" option, managers are pinned to their own branch
  (shown as a static chip).
- User menu: name, staffId, role badge; links to change password and (if not
  enabled) two-factor setup; sign out via `authClient.signOut()` →
  `router.invalidate()` → `/login`.
- Dashboard (`_authenticated/index.tsx`): session summary + count cards from list
  endpoints (branches/terminals/staff) and the five most recent audit entries; no
  new API.
- Add shadcn components as needed (verify each with the CLI):
  `table dialog alert-dialog dropdown-menu badge card tabs sonner separator
  skeleton sheet`.

**Verify:** mobile-accessible sidebar, visible keyboard focus, no console errors;
a manager cannot see or open Branches create/Staff admin-only sections; active
branch persists across reloads.
**Commit:** `feat(admin): add permission-aware app shell and branch switcher`

## Task 5 — CRUD screens

**Files:** `admin/src/routes/_authenticated/branches.tsx`, `branches.$id.tsx`,
`terminals.tsx`, `staff.tsx`, `audit.tsx`, `settings.tsx`,
`admin/src/components/**` (shared table states, confirm dialog, copy button,
pagination)

- **Branches:** list (code, name, type, city/area, status); create dialog (type,
  city, area, name) with an editable suggested code from
  `GET /api/branches/suggest-code?city&area&type` (re-fetch on field blur, show
  `adjusted` hint); detail/edit (`PATCH`; manager only name/address/phone per API);
  deactivate with confirmation (admin only, `branch.deactivate`). Manager sees only
  their branch.
- **Terminals:** list filtered by active branch (admin can pick any; manager
  pinned); create dialog (branch + name; code `<CODE>-Tnn` allocated server-side
  and shown after creation); enrollment dialog: `POST /api/terminals/:id/enrollment`
  → show `{ code, expiresAt }` with a live expiry countdown + copy button, and a
  note that issuing a new code expires the previous one; devices panel per terminal
  (fingerprint, status, enrolled/last seen) with revoke confirmation.
- **Staff:** filters (role, branch, active toggle, debounced search); table
  (staffId, name, email, role, branch, status, 2FA); create dialog (email, name,
  role, branch, phone) constrained by role — managers may only create
  MANAGER/CASHIER in their branch; on success show the temporary password once
  (copy + "emailed to …") in a dismissible dialog; edit role/branch (admin) and
  name/phone; reset password (fresh-session; show temp password once; handle
  `REAUTH_REQUIRED` with a re-sign-in prompt); deactivate/reactivate with
  confirmation; self-deactivate disabled.
- **Audit:** filters (actor staff select, action text, entity text, branch, from/to
  date inputs), paginated table, row expand → before/after diff viewer (structured
  key/value with changed keys highlighted), request ID copy.
- **Settings:** resolved list grouped by scope with source badges; editors per type
  (text/number/boolean); `receipt.header` editable per active branch; global keys
  disabled for managers (server enforces too); `PATCH /api/settings` per change.
- All screens: TanStack Query with loading/empty/error states, mutations invalidate
  related keys (`['branches']`, `['terminals', branchId]`, `['staff', filters]`,
  `['audit', filters]`, `['settings', branchId]`), toasts carry the request ID on
  failure.

**Verify:** every screen performs a real API round trip against local Postgres;
actions appear in the audit log; manager scope is enforced by the API even if a URL
is typed.
**Commit:** `feat(admin): add branch, terminal, staff, audit, and settings screens`

## Task 6 — Continuous integration

**Files:** `.github/workflows/ci.yml`

- Trigger: PRs and pushes to `dev` and `staging`.
- Job (ubuntu-latest): `actions/checkout@v7`, `oven-sh/setup-bun@v2` (reads
  `packageManager` bun@1.3.14), Postgres 18 service with `pg_isready` healthcheck
  (`POSTGRES_DB=gikautos_test`), `bun install --frozen-lockfile`, `bun run lint`,
  `bun run check-types`, `bun run db:migrate`, `bun run test`, `bun run build`.
- Workflow env: `NODE_ENV=test`, test-only `BETTER_AUTH_SECRET` (32+ chars),
  `DATABASE_URL`/`TEST_DATABASE_URL` pointing at the service database; no external
  services, no secrets.
- Local verification: run the same commands against the local test database and
  lint the workflow YAML with `bunx actionlint` if available. Pushing/watching CI
  is deferred until a git remote exists (record in STATE open items).

**Verify:** all commands pass locally in order; workflow YAML is valid; a
deliberately broken type fails `bun run check-types`.
**Commit:** `ci: add lint, typecheck, test, migrate, and build workflow`

## Task 7 — Phase verification and state update

**Files:** `.planning/phases/01-foundation/01-VERIFICATION.md`, `.planning/STATE.md`,
`.planning/ROADMAP.md`

- Run the five roadmap success criteria end to end against a fresh database
  (recreate dev DB, `db:migrate`, `db:seed`, `db:seed --demo`, run api + admin):
  1. Admin creates branch + warehouse + terminal + manager + cashier.
  2. Manager is branch-scoped; cashier cannot access admin functions.
  3. Enrollment code generated, listed, revoked (redeem still returns 501 by
     contract).
  4. Every mutation appears in the audit log.
  5. `lint`, `check-types`, `test`, `build` pass locally (CI parity verified
     locally; remote run deferred).
- Record evidence (commands, test names, curl transcripts) in the verification file.
- Mark Phase 1 complete in `STATE.md`; tick the phase in `ROADMAP.md`; carry the
  "no git remote yet" item forward.

**Verify:** a human can reproduce each criterion from the runbook notes.
**Commit:** `docs(planning): verify phase 1 foundation and update state`

## Wave 4 Done When

All five Phase 1 success criteria are proven against a fresh database; the console
is usable by both admin and manager roles against the live API; lint, typecheck,
tests, and builds pass with CI-equivalent commands.

## Human Verification Required

1. Forced TOTP enrollment for the bootstrap admin (authenticator app + backup
   codes download).
2. First-login forced password change for a seeded manager (temp password).
3. Manager scoping across branches in the UI (attempt a direct URL to another
   branch).
4. Password reset end to end using the dev mail folder (`api/.mail/`).
5. Terminal enrollment code expiry and revocation behavior.
