---
phase: 08-admin-modules-shell
plan: 02
wave: 2
title: Shared pickers, auth, audit, and settings modules
requirements: [UIX-06]
depends_on: [01]
status: planned
created: 2026-10-24
---

# Plan 02 — Shared Pickers, `auth`, `audit`, `settings`

**Goal:** Break the two component cycles before any module exists, then prove the module recipe
on the console's three least risky domains. After this plan the pattern is established, the
gate's pending list is three items shorter, and the next nine plans are repetition.

## Task 1 — Promote the two cross-domain pickers to `common`

**Files:** `admin/src/components/common/supplier-combobox.tsx` (moved),
`admin/src/components/common/product-picker.tsx` (moved),
`admin/src/components/inventory/supplier-picker.tsx`,
`admin/src/components/inventory/receive-dialog.tsx`,
`admin/src/components/payables/invoice-form.tsx`,
`admin/src/components/payables/invoice-lines-editor.tsx`,
`admin/src/components/payables/payment-form-dialog.tsx`,
`admin/src/components/suppliers/supplier-product-dialog.tsx`,
7 route files under `suppliers/` and `inventory/`

- Move, do not rewrite: `git mv` both files, update every importer's specifier, touch nothing
  else. Measured importers: `supplier-combobox` ← 7 files across suppliers, inventory and
  payables; `product-picker` ← 2 files across suppliers and payables.
- `components/inventory/supplier-picker.tsx` stays in inventory (it is inventory's own wrapper)
  and now imports the common combobox.
- This is D5's "used by three or more modules" rule applied at the moment it is cheapest. State
  in a comment on each moved file why it is common: without the move,
  `inventory ↔ suppliers` and `suppliers ↔ inventory` are a barrel cycle (F4).

**Verify:** `grep -rn "#/components/suppliers/supplier-combobox\|#/components/inventory/product-picker" admin/src` returns nothing; `bun run lint`, `bun run check-types`, and
`bun run --filter admin build` pass; the supplier picker works in the receive dialog, the
invoice form, and the payment form (manual).

**Commit:** `refactor(admin): move the two cross-domain pickers into common`

## Task 2 — `modules/auth`

**Files:** new `admin/src/modules/auth/{pages,components,api,index.ts}`;
`admin/src/components/auth/auth-shell.tsx` (moved);
routes `login.tsx`, `forgot-password.tsx`, `reset-password.tsx`, `two-factor.tsx`,
`_authenticated/change-password.tsx`

- Pages: `login-page`, `forgot-password-page`, `reset-password-page`, `two-factor-page`,
  `change-password-page`. Extract each route body verbatim.
- `api/change-password.ts` holds the one fetcher (`POST /api/me/password`) plus its
  `queryOptions`/mutation factory; `lib/auth-client.ts`, `lib/auth-policy.ts` and
  `lib/session.functions.ts` are infrastructure and stay in `lib/` (D5).
- Keep every `beforeLoad` redirect and `validateSearch` schema **on the route** (D6) — login's
  `redirect` search param, reset's token, 2FA's `setup=1`.
- `index.ts` exports the five pages. No module may import another module here.

**Verify:** all five routes ≤ 25 lines and match the target shape; sign in, forced TOTP
bootstrap, forgot/reset, forced password change, and 2FA challenge all behave exactly as before
(walkthrough steps 1 and the auth legs of the Phase 7 evidence script re-run green).

**Commit:** `refactor(admin): move the auth screens into the auth module`

## Task 3 — `modules/audit`

**Files:** new `admin/src/modules/audit/{pages,api,types,utils,index.ts}`;
route `_authenticated/audit.tsx`; `admin/src/lib/api-types.ts`; `admin/src/lib/api.ts`

- `pages/audit-page.tsx`: the 313-line route body, with its inline query replaced by
  `useQuery(auditListOptions(query))`.
- `api/keys.ts` (`auditKeys`), `api/audit.ts` (fetcher + options factory). Move the
  `api.audit` group out of `lib/api.ts`.
- `types/` takes `AuditEntry` and `AuditListQuery` out of `lib/api-types.ts`.
- `utils/` takes the diff-formatting helpers currently inline in the page; keep them pure so
  they are unit-testable later.
- The page keeps using `useDebouncedValue` from `#/lib/hooks` and `useBranch` from
  `#/lib/branch-context`.

**Verify:** `/audit` lists entries, filters by actor/entity/branch, paginates, and opens the
diff viewer exactly as before; `grep -rn "api.audit" admin/src` returns nothing.

**Commit:** `refactor(admin): move the audit log into the audit module`

## Task 4 — `modules/settings`

**Files:** new `admin/src/modules/settings/{pages,api,types,ui,index.ts}`;
route `_authenticated/settings.tsx`; `lib/api-types.ts`; `lib/api.ts`

- `pages/settings-page.tsx` from the 378-line route; `SettingRow` becomes
  `ui/setting-row.tsx` (presentational, no fetching).
- `api/keys.ts` + `api/settings.ts`; move the `api.settings` group.
- `types/` takes `SettingKey` (the discriminated union), `ResolvedSetting`,
  `SettingsUpdateInput`.
- The page keeps reading `activeBranchId` from the branch context — settings are branch-scoped
  and that must not change.

**Verify:** every setting group renders and saves; a manager still sees only their branch's
values and cannot reach an admin-only key (server-enforced; the UI hides it as before);
`grep -rn "api.settings" admin/src` returns nothing.

**Commit:** `refactor(admin): move settings into the settings module`

## Task 5 — Clear the three names from the gate

**Files:** `scripts/check-modules.mjs` (**controller-owned**, `NEEDS_LANE_CHANGE`),
`admin/biome.json`, `admin/src/components/auth/` (deleted)

- Remove `auth`, `audit`, `settings` from `PENDING_MODULES`.
- Add `#/components/auth/**` to the legacy-domain group in `admin/biome.json` so the two
  remaining files cannot be re-imported.
- Delete the now-empty `components/auth/` directory.

**Verify:** `bun run modules:check` passes with eleven pending modules and three migrated ones;
`bun run lint` clean; `bun run test` counts unchanged (API 360, shared 96, desktop 339).

**Commit:** `chore(admin): record the first three migrated modules`

## Definition of Done

- `modules/{auth,audit,settings}` each have a barrel and only folders with content.
- Five auth routes, `audit`, and `settings` are thin routes importing one page.
- `lib/api-types.ts` and `lib/api.ts` are measurably smaller (record the new line counts in the
  commit body).
- Zero behaviour change on the five auth screens, the audit log, and settings.
- The component-picker cycle is gone before a single module barrel could recreate it.
