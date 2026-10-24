---
phase: 08-admin-modules-shell
plan: 01
wave: 1
title: Module scaffolding, import convention, and the modules gate
requirements: [UIX-06]
depends_on: []
status: planned
created: 2026-10-24
---

# Plan 01 — Module Scaffolding, Import Convention, and the Modules Gate

**Goal:** The module architecture is written down, the import boundary fails the build when it
is crossed, and a single command proves the phase goal — before a single screen moves.

Nothing in this plan changes what the console does.

## Task 1 — Write the module contract

**Files:** `admin/src/modules/README.md` (new)

- State the five rules, in the order a developer needs them:
  1. **Folders:** only `api/`, `components/`, `hooks/`, `pages/`, `types/`, `ui/`, `utils/`,
     plus `index.ts`. Create a folder when it has real content (D2) — never an empty one.
  2. **`ui/` never fetches.** No `useQuery`, `useMutation`, `api`, or `apiRequest` in `ui/`.
     `components/` may be connected and take data from `hooks/` or the page. `pages/` compose.
  3. **Imports inside a module are relative** (`./`, `../`); **across modules, only the barrel**
     `#/modules/<name>`. This is required, not stylistic: Biome's `noRestrictedImports` has no
     importer-aware scope (see `01-RESEARCH.md` F2).
  4. **`api/` owns keys and queries.** `api/keys.ts` holds key factories; each domain file holds
     fetchers plus `queryOptions()` factories (the documented TanStack pattern). No `queryKey`
     is written inline in a page or component.
  5. **Route path ≠ module ownership.** `/suppliers/invoices` is a `payables` page;
     `/customers/aging` is a `credit` page. The route file is only a URL declaration.
- Record the cross-module graph as it will stand: `inventory → payables`,
  `suppliers → payables`, `customers → credit`, `customers → loyalty`, everything else acyclic.
  The two pickers promoted in Plan 02 are what make it acyclic — say so, so nobody re-introduces
  the edge.

**Verify:** the file exists and every rule names the mechanism that enforces it.

**Commit:** `docs(admin): write down the module architecture contract`

## Task 2 — Strengthen the import-boundary rule

**Files:** `admin/biome.json`

- Replace the scaffolded `patterns` group (Phase 7 Plan 04) with the two-pattern form from
  `01-RESEARCH.md` F1:

```json
{
  "linter": { "rules": { "style": { "noRestrictedImports": {
    "level": "error",
    "options": { "patterns": [
      { "group": ["#/modules/*/*", "#/modules/*/*/**"],
        "message": "Import the module barrel (#/modules/<name>) instead of reaching into its internals." },
      { "group": ["#/lib/api-types"],
        "message": "Types live in the owning module (#/modules/<name>). This file is retired in Phase 8." }
    ] }
  } } } }
}
```

- Keep the `components/ui/**` override block byte-identical; this task only touches the group.
- Add `#/lib/api-types` to the rule now even though the file still exists — it is the signal
  that a module must not pick up a type from the retiring barrel. Expect **zero** current
  violations; if there are any, fix the importer in the plan that owns that domain, not here.

**Verify:** `bun run lint` is still clean. Prove the rule bites with a throwaway file importing
`#/modules/x/components/y`, `#/modules/x/api`, and `#/modules/x` (the last must **pass**), then
delete it and confirm `git status` is clean for that path.

**Commit:** `chore(admin): widen the module import boundary to the whole module`

## Task 3 — Add the shell query keys

**Files:** `admin/src/lib/query-keys.ts` (new), `admin/src/lib/branch-context.tsx`

- Export `SHELL_KEYS = { branches: ["branches"] }` with a comment explaining F3: the shell needs
  the branch list before any module can be imported, so the key root lives in `lib/`, and
  `modules/branches/api/keys.ts` imports it rather than re-declaring it.
- Point `branch-context.tsx` at the constant. The key array must stay **exactly** `["branches"]`
  — any module invalidating `["branches"]` must still refresh the switcher (D9).

**Verify:** `grep -rn 'queryKey: \["branches"\]' admin/src` returns only `lib/query-keys.ts`
and the modules that import it. Branch switcher still updates after a branch edit
(manual: edit a branch name, the topbar label changes without a reload).

**Commit:** `refactor(admin): give the shell's branch query one declared key`

## Task 4 — The gate

**Files:** `scripts/check-modules.mjs` (new, **controller-owned**), `package.json` (new script,
**controller-owned**), `.github/workflows/ci.yml` (one step, **controller-owned**),
`admin/src/modules/.gitkeep`

- `bun run modules:check` runs the seven checks in `01-RESEARCH.md` §6, printing a table of
  modules and exiting non-zero on any failure. Follow `scripts/check-tokens.mjs`: plain Node
  ESM, no dependencies, `git ls-files` so build output cannot produce false results, and every
  allowance named in a comment with a reason.
- Two route exemptions only: `__root.tsx` and `dev-charts.tsx` (F9).
- `PENDING_MODULES` starts as the **fourteen** modules this phase migrates (D1's fifteen minus
  `analytics`). Each module plan deletes its own name; the gate requires the array to be empty,
  so the phase cannot finish half-migrated. `analytics` lives in a separate `DEFERRED` map with
  the phase that fills it (9), and the gate only asserts that a deferred module, if present, is
  an empty barrel.
- CI: add `- name: Modules check` / `run: bun run modules:check` after the token check.
- Wire the script into `cn`-style workspace checks only if it does not slow `bun run lint`; the
  gate is a separate command by design.

**Verify:** `bun run modules:check` fails today with a clear list of the fourteen pending
modules (expected — nothing has moved); the failure message names the plan that clears each.
`bun run lint`, `bun run check-types` unchanged.

**Commit:** `chore(admin): add the modules architecture gate`

## Task 5 — Prove the gate can fail

**Files:** `.planning/phases/08-admin-modules-shell/evidence/verify-module-gate.mjs` (new)

- Mutation-test the gate the way `verify-token-gate.mjs` proves `tokens:check`: create a
  temporary route that renders `<div>`, a module with a missing barrel, a deep cross-module
  import, a self-alias import, a legacy `#/components/<domain>` import, an `#/lib/api-types`
  import, a `domain: {` group in `lib/api.ts`, a stray folder under `modules/`, a 40-line route,
  an emptied `PENDING_MODULES` with no modules, and a removed CI step.
- Assert the gate exits non-zero for each and prints the expected message, then restore every
  file byte-for-byte (hash before/after) and assert the gate passes on the restored tree.

**Verify:** the script reports `11/11` and leaves `git status` clean. Run
`bun run modules:check` afterwards and record the output in `evidence/suites.txt`.

**Commit:** `test(phase-8): prove the modules gate can fail`

## Definition of Done

- `admin/src/modules/README.md` states the contract and names the enforcer for each rule.
- The Biome rule covers all seven folders, the folder index, and the retiring type barrel.
- `bun run modules:check` exists, is in CI, and fails with fourteen pending modules.
- The mutation script reports 11/11 and restores the tree exactly.
- No application behaviour has changed: `bun run lint`, `bun run check-types`,
  `bun run --filter admin build`, and the root `bun run test` counts are all unchanged.
