---
phase: 08-admin-modules-shell
plan: 03
wave: 3
title: Staff module — the 742-line route
requirements: [UIX-06]
depends_on: [02]
status: planned
created: 2026-10-24
---

# Plan 03 — `modules/staff`

**Goal:** The console's largest route file becomes a two-line route and a module that can be
read one file at a time. `staff.tsx` is the whole argument for Phase 8: 742 lines holding the
list, four dialogs, three mutations, and its formatting.

## Task 1 — Map the file before moving anything

**Files:** none (working notes in the commit body)

- Inventory the file's parts, which the plan expects to be: `StaffPage` (list, filters,
  pagination, reset/activate mutations), `CredentialsDialog`, `CreateStaffDialog`,
  `EditStaffDialog`, plus the PIN dialogs already extracted to `components/staff/`.
- List every `queryKey`/`invalidateQueries` site (measured: five `["staff"]` sites) and every
  rendered value, so the moves can be proven verbatim rather than reconstructed.

**Verify:** the note enumerates every function and every invalidation site; nothing is left for
"and the rest".

**Commit:** none (folded into Task 2's message).

## Task 2 — Build `modules/staff`

**Files:** new `admin/src/modules/staff/{api,components,hooks,pages,types,utils,index.ts}`;
`admin/src/components/staff/{pin-dialog,pin-status-badge}.tsx` (moved);
route `_authenticated/staff.tsx`; `lib/api.ts`; `lib/api-types.ts`

- `api/keys.ts` (`staffKeys.all = ["staff"]` — the two invalidation sites must keep invalidating
  the same root, so the reset, activate, create, and update mutations still refresh the list);
  `api/staff.ts` holds the `api.staff` group and `staffListOptions(query)`.
- `components/`: `staff-table`, `credentials-dialog`, `create-staff-dialog`, `edit-staff-dialog`.
  Each takes props and data from the page or a hook; none imports another module.
- `hooks/use-staff-mutations.ts` holds the reset, activate, create, and update mutations with
  their invalidations — this is the case D3 exists for: three components and the page share them.
- `types/`: `Staff`, `StaffPinStatus`, `SetStaffPinResult`, `CreateStaffResult`,
  `ResetPasswordResult`, `StaffCreateInput`, `StaffUpdateInput`, `SetStaffPinInput`,
  `StaffListQuery`.
- `utils/`: the role/branch/PIN-status label and tone maps currently inline.
- Route becomes `createFileRoute("/_authenticated/staff")({ component: StaffPage })`.
- Preserve exactly: the temporary-PIN reveal and copy, the "Temporary" badge, the PIN reset
  dialog and its `pinVersion`/`pinMustChange` display, managers seeing only their branch's
  cashiers, and every permission gate on every action.

**Verify:** every route file ≤ 25 lines; `grep -rn "api.staff" admin/src` returns nothing;
`grep -rn 'queryKey: \["staff"' admin/src` finds only `api/keys.ts`; manual pass — create a
staff member, reset their PIN (temporary badge appears, PIN never rendered), change role,
deactivate, and confirm the list refreshes without a reload in each case;
`bun run lint`, `bun run check-types`, `bun run --filter admin build` green.

**Commit:** `refactor(admin): move staff into the staff module`

## Task 3 — Clear the name and record the suite

**Files:** `scripts/check-modules.mjs` (**controller-owned**, `NEEDS_LANE_CHANGE`),
`admin/biome.json`

- Remove `staff` from `PENDING_MODULES`; add `#/components/staff/**` to the legacy group;
  delete the emptied `components/staff/` directory.

**Verify:** `bun run modules:check` passes with ten pending; root `bun run test` unchanged
(API 360, shared 96, desktop 339); append the run to
`.planning/phases/08-admin-modules-shell/evidence/suites.txt`.

**Commit:** `chore(admin): record staff as migrated`

## Definition of Done

- `staff.tsx` is a thin route; the module holds nothing over ~200 lines.
- The four mutations and their invalidations moved without a behaviour change.
- No secret material (temporary PIN, hash, token) is reachable from a `types/` or `utils/` export
  — D-invariants from `AGENTS.md` (no PINs, tokens, or hashes in logs or client state) still hold.
- Screens behave exactly as before, proven by the manual pass and the unchanged suite counts.

## Note on D9

This plan is the one most likely to tempt a "while I'm here" cleanup. Do not take it: if the
list's default sort, page size, or filter debounce changes here, the phase's "no behaviour
change" claim can no longer be verified separately from the move. Record any genuine defect
found in `.planning/STATE.md` for Phase 10/14 instead.
