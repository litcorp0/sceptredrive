---
phase: 08-admin-modules-shell
plan: 04
wave: 4
title: Branches and terminals modules
requirements: [UIX-06, UIX-07]
depends_on: [03]
status: planned
created: 2026-10-24
---

# Plan 04 — `modules/branches` and `modules/terminals`

**Goal:** The organisation tree is the first pair of modules that share a type (`Branch`), so it
proves the barrel-as-type-source rule. It is also where UIX-07's branch context becomes
module-aware without moving the context itself.

`branches.tsx` is 324 lines, `branches.$id.tsx` 211, `terminals.tsx` 441.

## Task 1 — `modules/branches`

**Files:** new `admin/src/modules/branches/{api,components,pages,types,utils,index.ts}`;
routes `_authenticated/branches.tsx`, `_authenticated/branches.$id.tsx`;
`lib/api.ts`; `lib/api-types.ts`; `lib/branch-context.tsx`

- `api/keys.ts` imports `SHELL_KEYS.branches` from `#/lib/query-keys` rather than re-declaring
  `["branches"]` (research F3). The list fetcher stays in the module; the **shell** keeps its own
  direct call in `lib/branch-context.tsx`, so `lib` never imports a module.
- `api/branches.ts` takes the `api.branches` group, including `suggestCode`.
- `pages/branches-page.tsx` (list + create dialog) and `pages/branch-detail-page.tsx`
  (deactivate + edit). Extract `CreateBranchDialog`/`EditBranchDialog` into `components/`.
- `types/`: `Branch`, `BranchType`, `BranchCreateInput`, `BranchUpdateInput`, `BranchListQuery`,
  `SuggestCode`.
- `index.ts` must export the `Branch` **type** as well as the pages: it is the first shared type
  in the phase, and every other module consumes it with `import type { Branch } from
  "#/modules/branches"`. Type-only imports are erased at build time, so they cannot create a
  runtime cycle.
- Confirm the warehouse-vs-retail distinction is still only *displayed* here; the server still
  refuses a POS terminal on a warehouse.

**Verify:** create a branch (code suggestion works), edit it, deactivate it; the topbar switcher
updates without a reload (it shares the key root); `/branches/$id` deep-links.

**Commit:** `refactor(admin): move branches into the branches module`

## Task 2 — `modules/terminals`

**Files:** new `admin/src/modules/terminals/{api,components,pages,types,utils,index.ts}`;
route `_authenticated/terminals.tsx`; `lib/api.ts`; `lib/api-types.ts`

- `api/terminals.ts` takes the `api.terminals` group **verbatim**, including enrollment
  creation/listing and device listing/revocation.
- `components/`: `terminal-form-dialog`, `enrollment-dialog` (the one-time code surface),
  `device-table`, `revoke-device-dialog`, extracted from the route.
- `types/`: `Terminal`, `Device`, `DeviceStatus`, `Enrollment`, `TerminalCreateInput`,
  `TerminalUpdateInput`, `TerminalListQuery`.
- Preserve exactly: the one-time enrollment code reveal and its copy-to-clipboard, the
  "code is shown once" warning, device status badges, and the fact that revoking a device does
  not revoke the terminal.
- The invitation code is a credential: it must not be logged, and it must not appear in a
  React Query key. Check both before committing.

**Verify:** create a terminal, generate an enrollment code, copy it, list devices, revoke one.
`grep -rn "api.terminals" admin/src` returns nothing. No enrollment code or device token appears
in any `queryKey` or `console.*`.

**Commit:** `refactor(admin): move terminals and devices into the terminals module`

## Task 3 — Clear the names, and check the shell's branch lock

**Files:** `scripts/check-modules.mjs` (**controller-owned**, `NEEDS_LANE_CHANGE`),
`admin/biome.json`

- Remove `branches` and `terminals` from `PENDING_MODULES`; extend the legacy group.

**Verify (UIX-07, first half):** signed in as a **manager**, the branch switcher renders as a
locked badge, `canSelectBranch` is false, and changing the URL's branch query on
`/staff` or `/inventory/stock` does not show another branch's rows (the server is authoritative;
this step proves the client does not pretend otherwise). Record the observation — Plan 13 turns
it into an automated check.

**Commit:** `chore(admin): record branches and terminals as migrated`

## Definition of Done

- Both routes and the branch detail route are thin; six of fourteen modules migrated.
- `Branch` is imported across modules only from `#/modules/branches`, and `lib` imports no
  module (the gate's self-import and the Biome group both hold).
- The shell's branch behaviour is unchanged: admins switch, managers are pinned, the switcher
  refreshes through one shared key root.
- No credential material in keys, logs, or rendered state beyond the intended one-time reveal.
