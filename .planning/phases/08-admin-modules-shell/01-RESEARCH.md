# Phase 8 — Research

**Goal (unchanged, from the roadmap):** every admin screen is assembled inside a domain module
and the route file only routes, so a feature can be understood, tested, and changed without
reading the router.

**Requirements:** UIX-06, UIX-07.
**Date:** 2026-10-24.
**Status:** research complete; 13 plans drafted.

---

## 1. Sources consulted

| Source | Used for |
|---|---|
| `https://tanstack.com/query/latest/docs/framework/react/guides/query-options` | `queryOptions()` is the documented way to co-locate a key and its fetcher and share both. Confirms the `api/` + `hooks/` split in D2/D7 is the official pattern, not an invention. |
| `https://biomejs.dev/linter/rules/no-restricted-imports/` | `patterns`/`group` are gitignore-style and arrived in **v2.2.0**; this repo pins **2.4.5**, so the rule is available. The rule has **no importer-aware scoping** — it cannot say "allow a module to deep-import itself". Negative `!` groups exist but are also import-string based. |
| `admin/` source tree | Every number and move in §2–§6 was measured with `find`, `grep`, and `wc`, not estimated. |
| `.planning/phases/08-admin-modules-shell/00-CONTEXT.md` | The ten locked decisions D1–D10. |

## 2. Measured state (supersedes the figures in `00-CONTEXT.md`)

The context document was written when Phase 7 started. The admin has grown since.

| Fact | `00-CONTEXT.md` says | Measured now | Consequence |
|---|---|---|---|
| Route files | 8,682 lines | **53 files, 9,770 lines** | The verification line budget (D10) must be stated as a per-file cap, not a total |
| `staff.tsx` | 742 lines | 742 lines | unchanged |
| `admin/src/modules/` | (to be created) | **does not exist** | Phase 8 creates it |
| Domain components | (not stated) | **64 files** in `components/{auth,catalog,customers,inventory,payables,staff,suppliers}` | The real bulk of the move |
| `lib/api.ts` | (not stated) | 651 lines; `apiRequest`/`ApiError`/`isReauthRequired` + a 15-group `api` object | Transport stays, groups move |
| `lib/api-types.ts` | (not stated) | **1,485 lines**, already ordered by domain | The split is mechanical but large |
| Inline TanStack query sites | (not stated) | **79 `queryKey:` occurrences inside `routes/`** | D7 is the most labour-intensive part of the phase |
| Admin tests | "suite counts unchanged" (D10) | **none** — `admin/package.json` has no `test` script and there are zero test files | D10 as written cannot be satisfied; see §6 |

Largest route files, in migration order: `staff` 742, `customers/$id/index` 470, `terminals` 441,
`settings` 378, `inventory/counts/$countId` 372, `two-factor` 329, `branches` 324,
`suppliers/payments/index` 322, `suppliers/invoices/index` 320, `dev-charts` 315, `audit` 313,
`catalog/products/index` 311, `suppliers/invoices/$invoiceId` 306.

## 3. Findings that change the plan

### F1 — The scaffolded boundary rule has three holes

`admin/biome.json` currently restricts `#/modules/*/{components,ui,hooks,api}/**`. It does not
cover `pages/`, `types/`, or `utils/`, and `**` does not match the folder itself, so
`#/modules/x/api` (the folder index) is also allowed. A rule that lets a module reach into
another module's pages is not a boundary.

**Fix:** restrict everything below a module except its barrel, with two patterns:

```json
{ "group": ["#/modules/*/*", "#/modules/*/*/**"], "message": "…" }
```

`#/modules/inventory` (the barrel) does not match either. `#/modules/inventory/api` and
`#/modules/inventory/components/x` match the first pattern. This is a **deliberate
strengthening** of D4 and is proven by mutation in Plan 01.

### F2 — The rule cannot allow a module to import itself, so intra-module imports must be relative

`noRestrictedImports` has no per-importer scope (see §1). Therefore **inside
`modules/<name>/`, imports are relative (`./`, `../`); across modules, imports use the barrel
`#/modules/<name>`.** The repo uses `#/` everywhere today, so this is a new, explicit
convention, recorded in `admin/src/modules/README.md` and enforced by `modules:check` (which
fails on `#/modules/<self>/` inside its own module). Without this rule the very first module
would fail lint against itself.

### F3 — `lib/branch-context.tsx` would create a `lib → module → lib` cycle

The shell's branch provider calls `api.branches.list()` with `queryKey: ["branches"]`, and
three route files also use `["branches"]`. If the provider imports `modules/branches/api`, the
graph becomes `lib → modules/branches → lib`.

**Fix:** add `admin/src/lib/query-keys.ts` exporting `SHELL_KEYS = { branches: ["branches"] }`.
`lib/branch-context.tsx` keeps calling the transport directly and uses that constant;
`modules/branches/api/keys.ts` imports the same constant for its key root. No cycle, and the
cache key is byte-identical, so nothing observable changes (D9).

### F4 — Two cross-domain leaf components already form a cycle

Measured component→component edges:

```
inventory  → suppliers   (receive-dialog, supplier-picker → supplier-combobox)
suppliers  → inventory   (supplier-product-dialog → product-picker)
payables   → suppliers   (invoice-form, payment-form-dialog → supplier-combobox)
payables   → inventory   (invoice-lines-editor → product-picker)
```

`supplier-combobox` is used by **three** domains (suppliers, inventory, payables) and
`product-picker` by **three** (inventory, suppliers, payables). D5 already says a component used
by three or more modules belongs in `components/common`. Promoting exactly these two breaks both
cycles **before** any module exists, so no barrel ever has to import a module that imports it
back. This is a one-commit precondition in Plan 02.

One deliberate exception is left: `inventory/receipts/$receiptId` renders
`payables/invoice-status-badge` (a receipt's linked payable). That is an honest
`inventory → payables` edge with no reverse edge, so it becomes a barrel import in Plan 11.

### F5 — 79 inline query sites are the real work, and `queryOptions` is the answer

Every page currently declares `queryKey` inline. The official pattern puts key + fetcher in one
factory. Each module therefore gets:

```
api/keys.ts        key factories (reads SHELL_KEYS where the root is shared)
api/<domain>.ts    fetchers over apiRequest + <x>Options() queryOptions factories
hooks/             only where logic is shared by more than one page/component
```

Pages call `useQuery(xOptions(params))`; that is composition, not a connected component, so D3
is untouched (`ui/` still never fetches).

### F6 — There is no admin test suite, so "suite counts unchanged" must be redefined

`admin/package.json` has no `test` script and the package has no test files; root
`bun run test` therefore skips it (`--if-present`). The only automated regression net for the
9,770-line move is the Phase 7 Playwright walkthrough
(`.planning/phases/07-identity-design-system/evidence/walkthrough-admin.mjs`, 38/38), which
covers the shell, dashboard, audit, credit ledger, loyalty and one statement print — **six of
twenty-two screens**.

**Decision (operator, this session):** promote a section-coverage walkthrough to
`admin/test/walkthrough-sections.mjs`, visiting **every** route and asserting it rendered, with
the demo seed present. It is wired as `test:walkthrough`, **not** `test`, so root
`bun run test` keeps skipping the admin and CI stays fast. Per D10, D9's evidence is "the same
screens, same data, same permission behaviour" — not a re-assertion of every pixel.

### F7 — `playwright` is declared in `desktop/package.json` only

The Phase 7 evidence scripts at the repo root import `playwright` and work only because Bun's
hoisted linker puts it at the root. A walkthrough living in `admin/test/` must declare it:
`bun add -d playwright@1.64.1 --filter admin` (same version, no lockfile drift beyond the
workspace entry).

### F8 — Route file *paths* cannot move

TanStack file-based routing derives the URL from the file path, so `routes/` keeps its 53 files
and only their **contents** change. `routeTree.gen.ts` is regenerated by the dev server or
`bun run --filter admin generate-routes`; a diff to it after a migration means a file moved by
accident.

Corollary: **route path ≠ module ownership.** `/suppliers/invoices`, `/suppliers/payments` and
`/suppliers/aging` become pages of `modules/payables`; `/customers/aging` and
`/customers/$id/statement` become pages of `modules/credit`. That is the whole point of the
phase and must be stated in each module's barrel.

### F9 — Two route files legitimately keep markup

`routes/__root.tsx` (infrastructure) and `routes/dev-charts.tsx` (Phase 7's dev-only chart
gallery, deleted in Phase 9) are exempt from the thin-route gate, with the exemption written
into `scripts/check-modules.mjs` and justified in a comment — the same technique
`check-brand.mjs` uses for its allowlist. Section layout routes (`catalog/route.tsx`,
`customers/route.tsx`, `inventory/route.tsx`, `suppliers/route.tsx`) do **not** get an
exemption: they become `modules/<x>/pages/<x>-layout.tsx`. Pass-through parents
(`catalog/products.tsx`, `inventory/stock.tsx`, `customers/$id.tsx`) stay as bare `<Outlet />`.

### F10 — Nothing outside `admin/` changes, except four controller-owned files

`packages/**` and `api/**` are untouched. The phase therefore runs as **one writer lane**
(`admin-lane`); `verify` and `review` can run alongside. Four root-owned files are needed and
belong to the controller per `AGENTS.md`: `package.json` (the `modules:check` script),
`scripts/check-modules.mjs`, `.github/workflows/ci.yml` (one step), and `.planning/**`. The
lane reports `NEEDS_LANE_CHANGE` for those. `admin/biome.json` and `admin/package.json` are
inside the lane.

## 4. Move map (measured)

| Route(s) | → module | Components that move |
|---|---|---|
| `login`, `forgot-password`, `reset-password`, `two-factor`, `change-password` | `auth` | `components/auth/auth-shell` |
| `_authenticated/index` | `dashboard` | — |
| `audit` | `audit` | — |
| `settings` | `settings` | — |
| `staff` | `staff` | `staff/pin-dialog`, `staff/pin-status-badge` |
| `branches`, `branches/$id` | `branches` | — |
| `terminals` | `terminals` | — |
| `catalog/*` (7) | `catalog` | all 7 `catalog/*` |
| `inventory/*` (12) | `inventory` | all 11 `inventory/*`, minus `product-picker` → `common` |
| `customers/aging`, `customers/$id.statement` | `credit` | `credit-*`, `repayment-dialog`, `aging-table`, `statement-view` |
| `loyalty` | `loyalty` | `loyalty-*`, `liability-report` |
| `customers`, `customers/$id` | `customers` | `customer-form-dialog`, `customer-lifecycle-dialogs` |
| `suppliers`, `suppliers/$id` | `suppliers` | `supplier-*`, `payment-details-panel`, `supplier-overview`, `supplier-products-panel` |
| `suppliers/invoices*`, `suppliers/payments*`, `suppliers/aging` | `payables` | all 10 `payables/*` |
| (Phase 9) | `analytics` | — |

15 modules against D1's list; `analytics` stays empty until Phase 9, as D1 requires.

## 5. Target shape of a route file

```tsx
import { createFileRoute } from "@tanstack/react-router"
import { StaffPage } from "#/modules/staff"

export const Route = createFileRoute("/_authenticated/staff")({ component: StaffPage })
```

`beforeLoad`/`validateSearch`/`loader` stay on the route (D6). Everything else is in the module.

## 6. The gate

`scripts/check-modules.mjs` (`bun run modules:check`, wired into `ci.yml`) checks:

1. Every route file except the two exemptions is ≤ 25 lines, contains `createFileRoute(`,
   contains no `useQuery(`, `useMutation(`, `apiRequest(`, `toast.`, or any JSX other than a
   single `<Component />` / bare `<Outlet />`.
2. Exactly one `#/modules/…` barrel import per non-pass-through route.
3. Every `modules/<x>/` child folder is one of the seven; `index.ts` exists.
4. No file inside `modules/<x>/` imports `#/modules/<x>/…` (F2).
5. No file imports `#/lib/api-types`; no file imports `#/components/<migrated-domain>/…`.
6. `lib/api.ts` contains no `domain: {` group.
7. `PENDING_MODULES` is empty — each module plan deletes its own name, so the gate is a
   checklist that cannot be forgotten.

`evidence/verify-module-gate.mjs` mutates the tree eleven ways (route markup, missing barrel,
deep import, self-import, legacy import, api-types import, `api` group, missing `index.ts`,
over-long route, stray folder, dropped CI step) and asserts the gate fails each time, restoring
every file byte-for-byte — the `verify-token-gate.mjs` precedent (22/22).

## 7. Deviations from D8's migration order (both deliberate)

D8 lists: audit → settings → staff → branches/terminals → catalog → inventory →
customers/credit → loyalty → suppliers/payables → dashboard.

1. **credit and loyalty come before customers.** `customers/$id/index.tsx` (470 lines) is the
   composition root for all three: it renders the credit profile dialog, the credit ledger, the
   repayment dialog and the loyalty card. If `customers` migrated first it would still import
   `#/components/customers/credit-*` — i.e. its own folder — which is exactly the ambiguity the
   phase exists to remove. Ordering credit → loyalty → customers makes the composition
   explicit: `customers` imports two barrels.
2. **suppliers and payables are separate plans, suppliers first.** Measured, they are 9 routes
   and 19 components — double any other module. Splitting keeps each commit reviewable, and
   suppliers first lets payables' two supplier-facing imports become barrel imports in the same
   phase. The only edge left pointing at a not-yet-migrated domain is
   `inventory → payables` (F4), resolved at the end of Plan 11.

`auth` is folded into Plan 02 with `audit`/`settings` rather than getting its own plan: it is
five small pages plus one component, and it proves the recipe on the least risky code.

## 8. Open items carried out of this phase

- `dev-charts.tsx` is deleted in Phase 9 when the real dashboard ships.
- `modules/analytics` is created empty in Phase 9, `modules/pos-oversight` in Phase 14.
- Nav badges / approval counts are Phase 12.
- `STAFF_ID_PREFIX=GA` is still an operator decision (carried from Phase 7); Phase 8 does not
  touch identity values.
