---
phase: 08-admin-modules-shell
plan: 12
wave: 12
title: Dashboard module and the role-aware shell audit
requirements: [UIX-06, UIX-07]
depends_on: [11]
status: planned
created: 2026-10-24
---

# Plan 12 — `modules/dashboard` and the UIX-07 shell audit

**Goal:** Close the module list, then audit the shell against UIX-07 and fix only what is
actually missing. Phase 7 Plan 06 built most of the shell; this plan proves it rather than
rebuilding it.

## Task 1 — `modules/dashboard`

**Files:** new `admin/src/modules/dashboard/{api,pages,index.ts}`;
`routes/_authenticated/index.tsx`; `lib/api.ts`

- `pages/dashboard-page.tsx` from `_authenticated/index.tsx` (110 lines). It is a placeholder
  summary today and is rewritten wholesale in Phase 9 — so move it **as is**, with a
  `TODO(phase-9)` naming the rewrite, and extract no components.
- `api/` holds any fetch the page makes and its key; if the page makes none beyond the branch
  context, create no `api/` folder (D2 forbids empty folders) and say so in the commit body.
- Remove `dashboard` from `PENDING_MODULES` in `scripts/check-modules.mjs`
  (**controller-owned**).

**Verify:** `/` renders the same figures as before; `bun run modules:check` passes with fourteen
modules migrated and `PENDING_MODULES` empty — `analytics` stays deferred to Phase 9.

**Commit:** `refactor(admin): move the dashboard into the dashboard module`

## Task 2 — Audit the shell against UIX-07

**Files:** none in the first pass (findings recorded); fixes in Task 3

Walk the criterion clause by clause against the built shell and record evidence for each:

| UIX-07 clause | Where it lives today | What to prove |
|---|---|---|
| Permission-filtered navigation | `components/layout/sidebar.tsx` `NAV_GROUPS[].permission` | Sign in as each of the three roles; the visible item set matches `can(role, permission)`; an item hidden in the UI returns 403 from the API when the URL is typed |
| Branch context managers cannot escape | `lib/branch-context.tsx` (`canSelectBranch = role === "ADMIN"`), `components/layout/branch-switcher.tsx` | Manager sees a locked badge, no `Select`, and a query string naming another branch returns none of that branch's rows |
| Keyboard-operable mobile drawer | `components/ui/sidebar.tsx` + the Phase 7 tooltip fix | At 375 px: Tab reaches the trigger, Enter opens, focus is trapped, Escape closes once, links are reachable |
| Skip link reaches main first | `components/layout/app-shell.tsx` | First Tab exposes "Skip to main content"; activating it focuses `main#main` |
| Navigation is not the only truth | API permission checks | Every route still loads only what the API allows; the shell filter is cosmetic (assert it is not the enforcement) |

- Check specifically for **module-related drift**: the nav table still points at route paths
  (correct — paths did not change), and no module became a second source of navigation.

**Verify:** the table is filled in with a command or a recorded step per row. Anything already
satisfied is marked "verified, no change" — that is the expected outcome for most rows.

**Commit:** none if the pass is clean (findings go into Plan 13's evidence file).

## Task 3 — Fix only the gaps

**Files:** whichever row failed, plus `components/layout/*` if needed

- Rules for this task: a fix must be an accessibility or correctness defect in UIX-07's own
  clauses. A visual preference is **not** a gap (D9), and a new feature — nav badges, approval
  counts, a command palette — is Phase 12 and must not be added here.
- If a row fails because the API is the real problem, stop and record it: the API is not in this
  phase's scope, and an API change needs its own decision.

**Verify:** the failed row now passes and the row's evidence line in Task 2's table is updated to
"fixed in this plan".

**Commit:** `fix(admin): close the <specific> gap against UIX-07`

## Task 4 — Prove no behaviour changed in the shell

**Files:** `.planning/phases/08-admin-modules-shell/evidence/capture-shell.mjs` (copied and
adapted from the Phase 7 script, **controller-owned** if it must live outside `admin/`)

- Re-run Phase 7's `capture-shell.mjs` assertions against the migrated tree: four nav groups, a
  single active brand rail, fascia height and colour, skip link first on Tab, 2 px focus outline,
  print hides chrome, dark persistence with no flash, 375 px drawer opens and Escape closes once.
- Capture the same screenshots (light, dark, mobile drawer) into this phase's `evidence/shots/`
  so a reviewer can compare against Phase 7's images side by side.

**Verify:** the script reports **16/16** and the three screenshots are byte-comparable in
layout terms to `phases/07-identity-design-system/evidence/shots/plan06-*` (a human comparison,
recorded as a note, not a pixel diff).

**Commit:** `test(phase-8): capture the shell on the migrated tree`

## Definition of Done

- Fifteen module directories exist once Phase 9 adds `analytics`; fourteen have pages and
  `PENDING_MODULES` is empty. `modules/analytics` is created empty in Phase 9, not here.
- UIX-07 is proven clause by clause, not asserted.
- The shell's only changes are derived from a failed clause.
- Phase 7's shell evidence reproduces on the new tree.
