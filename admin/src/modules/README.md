# Admin modules

Every screen in the console belongs to exactly one domain module. A route file declares a URL
and nothing else. This file is the contract; each rule names the thing that enforces it.

## Layout

```
modules/<domain>/
  api/         query keys and fetchers
  components/  connected UI (may fetch)
  hooks/       shared query/mutation logic
  pages/       composition roots; one per route
  types/       types and z.infer aliases
  ui/          presentational only — never fetches
  utils/       pure functions
  index.ts     the only entry point
```

A folder appears when it has real content. Never create an empty folder to look complete.

## Rules

**1. `ui/` never fetches.** No `useQuery`, `useMutation`, `api`, or `apiRequest` inside `ui/`.
`components/` may be connected and takes its data from `hooks/` or from the page.
`pages/` compose; a page calling `useQuery(xOptions(...))` is still composition, not a
connected component.

*Enforced by:* review, and the directory's stated purpose. Keep it obvious.

**2. Imports inside a module are relative; across modules, only the barrel.**

```ts
import { StaffTable } from "./components/staff-table"        // inside modules/staff
import { CreditLedgerTable } from "#/modules/credit"         // from another module
```

This is required, not stylistic. Biome's `noRestrictedImports` has no importer-aware scope, so a
rule that blocks `#/modules/*/*` also blocks a module from deep-importing itself. Relative
imports are the only convention that lets one rule cover everyone.

*Enforced by:* `admin/biome.json` (`noRestrictedImports`) and `bun run modules:check`, which
fails on `#/modules/<self>/` inside its own module.

**3. Keys and queries live in `api/`.** `api/keys.ts` holds key factories; each domain file holds
fetchers plus `queryOptions()` factories. No `queryKey` is written inline in a page or component.

```ts
// api/keys.ts
export const staffKeys = { all: ["staff"] as const, list: (q: StaffListQuery) => [...staffKeys.all, q] as const }

// api/staff.ts
export function staffListOptions(query: StaffListQuery) {
  return queryOptions({ queryKey: staffKeys.list(query), queryFn: () => apiRequest<...>("/api/staff", { query }) })
}
```

*Enforced by:* `bun run modules:check` (no `queryKey:` under `pages/` or `components/`). The old
`#/lib/api-types` shape file is gone: every response type lives in the `types/` folder of the module
that owns the domain, and `#/lib/api.ts` is the transport only (`apiRequest`, `ApiError`,
`isReauthRequired`) with no domain groups.

**4. Route path ≠ module ownership.** `/suppliers/invoices` is a `payables` page;
`/customers/aging` is a `credit` page. TanStack derives the URL from the file path, so the route
file cannot move — only its body can, into the module that owns the domain.

*Enforced by:* `bun run modules:check` (every route is ≤ 25 lines and imports exactly one barrel).

**5. A module may use the global folders (`components/ui`, `components/common`,
`components/layout`), anything in `lib`, `@sceptre/shared`, and its own files.** Anything else is a
cross-module import and goes through the barrel.

*Enforced by:* `admin/biome.json`.

## The dependency graph

```
inventory  → payables      (a goods receipt shows its linked invoice and its status)
payables   → inventory     (the invoice form reads goods receipts)
payables   → suppliers     (the invoice and payment forms read supplier terms and payment details)
suppliers  → payables      (the supplier list's owed column is a payables balance)
credit     → payables      (the shared aging bucket vocabulary)
customers  → credit        (the profile's credit tab)
customers  → loyalty       (the profile's loyalty tab)
catalog    ↔ procurement   (the product list shows the pending product-submission queue; a
                            manager's submission form reads the catalogue's categories, units
                            and brands)
```

`inventory ↔ payables`, `suppliers ↔ payables` and `catalog ↔ procurement` are the three two-way
edges. The first two are data, not screens: a receipt shows its invoice and an invoice form reads
receipts; a supplier list shows what is owed and a payment form lists the supplier's destinations.
Neither direction imports the other's *components* — the shared `invoice-status-badge`,
`supplier-combobox` and `product-picker` live in `components/common` precisely so no barrel has to
re-export a component into a cycle. `catalog ↔ procurement` is the product decision: the catalogue's
product list renders the pending `PRODUCT_CREATE` queue that procurement owns, and the submission
page reads reference data the catalogue owns. Every other pair is one-way and acyclic.

Those three shared pieces live in `components/common` **because** they are used by more than one
domain (`supplier-combobox` and `product-picker` by three each, the badge by two). Leaving a picker
in `suppliers/` and `inventory/` would make `inventory ↔ suppliers` a barrel cycle; leaving the
badge in `payables/` would make it `inventory ↔ payables`. Do not move them back.

## Adding a module

1. Create the folders you actually need plus `index.ts`.
2. Add its name to `REQUIRED_MODULES` in `scripts/check-modules.mjs` and to `PENDING_MODULES`
   until it is populated.
3. Move the bodies, leaving each route as `createFileRoute(...)({ component: Page })`.
4. Delete the old `components/<domain>/` folder in the same commit.
