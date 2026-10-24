---
phase: 08-admin-modules-shell
name: Admin Module Architecture & Shell
depends_on: [01-foundation, 02-catalog-pricing, 03-inventory-transfers, 04-customers-credit, 05-suppliers-payables, 06-pos-offline-core, 07-identity-design-system]
requirements: [UIX-06, UIX-07]
status: context-locked
created: 2026-10-24
---

# Phase 8 — Admin Module Architecture & Shell — Locked Context

**Goal:** Every admin screen is assembled inside a domain module and the route file only
routes, so a feature can be understood, tested, and changed without reading the router.

## Problem

`admin/src/routes/` holds 8,682 lines. `staff.tsx` is 742 lines containing the page, its
query hooks, its dialogs, and its formatting. `components/<domain>/` holds the reusable
pieces, so a single feature is split across two trees with no rule about what goes where.
Nothing enforces that the inventory module does not import a supplier dialog.

## Locked Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Module inventory | `auth`, `dashboard`, `analytics` (empty until Phase 9), `catalog`, `inventory`, `suppliers`, `payables`, `customers`, `credit`, `loyalty`, `staff`, `branches`, `terminals`, `audit`, `settings` | Mirrors the route tree and the API modules, so a domain is one word in all three places |
| D2 | Module shape | Each module has exactly `api/`, `components/`, `hooks/`, `pages/`, `types/`, `ui/`, `utils/`, plus an `index.ts` barrel. Empty folders are not created; a folder appears when it has real content | The operator's requirement, plus `api/` and `pages/` so `hooks/` stays readable and routes stay thin |
| D3 | Folder semantics | `ui/` = presentational, **never fetches**; `components/` = connected, takes data from `hooks/`; `api/` = query keys + fetchers; `hooks/` = TanStack Query + local state; `utils/` = pure functions, unit-tested; `types/` = types and `z.infer` aliases; `pages/` = composition | Without a hard rule, `ui/` and `components/` collapse into each other within a month |
| D4 | Import boundary | A module may import `#/components/ui`, `#/components/common`, `#/lib/*`, `@sceptre/shared`, and its own files. Cross-module use goes through `#/modules/<name>` only. Enforced by Biome `noRestrictedImports` glob patterns (rule scaffolded in Phase 7 Plan 04), not by review | A convention without a failing build is a suggestion |
| D5 | What stays global | `lib/` (api client, auth client, env, format, role, toast, session), `components/ui` (generated), `components/common` (used by three or more modules), `components/layout` (shell) | These are infrastructure, not domain. `PageHeader` and `EmptyState` are common because every module renders them |
| D6 | Route file shape | Each route file is: the `createFileRoute` call, a `validateSearch`/`loader`/`beforeLoad` when it has one, and a component that returns one module page. No markup, no queries, no handlers | The route layer should be boring enough to never need reading |
| D7 | Query keys and hooks | Query keys are declared in the module's `api/keys.ts` and consumed by that module's hooks. A key never leaks to another module's hook — the owning module exposes a hook, not a key | Stops the "invalidate everyone's cache" pattern that makes admin screens refresh each other |
| D8 | Migration order | audit → settings → staff → branches/terminals → catalog → inventory → customers/credit → loyalty → suppliers/payables → dashboard. One module per commit, mechanical moves only | Cheapest and most isolated first; the two largest domains (inventory, suppliers) land when the pattern is already proven |
| D9 | No behaviour change | Phase 8 does not change a query, a mutation, a permission check, or a rendered value. If a screen looks different, that is a Phase 7 token leak or a defect | A refactor and a feature in the same phase cannot be verified separately |
| D10 | Verification | Route files ≤ 25 lines; `grep` proves no page markup remains under `routes/`; the import-boundary probe fails as intended; every existing screen still loads data (manual pass per section); suite counts unchanged | Weakening a test to make a move "pass" is the failure mode this guards against |

## Invariants (carry from Phases 1–7)

- Server decides money, tax, credit, loyalty, stock, and permissions. The client renders.
- Permissions are checked server-side; navigation filtering is cosmetic only.
- Integer minor units; no float money anywhere, including chart data.
- No secrets or PII in logs or query keys.

## Open Items

- Phase 9 fills `modules/analytics` and `modules/dashboard` with real content and adds the
  Analytics nav item.
- Phase 14 adds POS oversight and conflict resolution as a new module.
- The admin `dev-charts` route from Phase 7 is deleted when the real dashboard ships.
