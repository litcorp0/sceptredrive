---
phase: 10-desktop-pos-redesign
plan: 02
title: modules/ scaffolding and the route → page split
lane: pos
depends_on: [01]
requirements: [UIX-08]
---

# Plan 02 — `modules/` scaffolding and the route → page split

## Goal

Every counter screen lives in exactly one domain module and every route file only routes.
About 5,000 lines move and **none of them change behaviour**: no markup is retuned, no class is
renamed, no query is rewritten. The referee is the existing suite, and every test must pass
without being edited.

This is deliberately the only plan in the phase that is a move. A failure here is a mistake in
the move; it is never an argument for changing a screen.

## Read first

- `00-DECISIONS.md` P10-D9, P10-D10, P10-D11.
- `desktop/src/renderer/modules/README.md` (written in Plan 01) — the contract.
- `admin/src/modules/README.md` — the same contract, one client over, with the two cycles
  Phase 8 designed out. It is the warning to read before moving anything.
- `desktop/src/renderer/routes/_pos/app.tsx:50-148` — the guard ladder that must not move.
- `desktop/src/renderer/lib/router.ts` — `parseHash`, `navigate`, `useHashRoute`.
- `scripts/check-modules.mjs` (admin) — what a module shape error costs.

## The move

Use `git mv` for every file, so `git diff -M` records renames and a reviewer can see that the
bodies are unchanged.

### Modules (D1's fourteen; `home` arrives in Plan 04)

```
modules/auth/        login page, pin-pad, manager-unlock
modules/cart/        cart line, cart totals
modules/catalog/     product search, product grid, scan listener, CatalogBrowser
modules/credit/      credit panel
modules/customers/   customer panel + its two dialogs, CustomerPanel
modules/loyalty/     loyalty panel + its redeem dialog, LoyaltyPanel
modules/receipt/     receipt page, receipt view
modules/sales/       today's-sales page
modules/sell/        sell page, discount dialog
modules/settings/    settings page
modules/shift/       shift page, shift dialogs
modules/sync/        sync page, conflict list, sync log
modules/tender/      tender page, tender panel
```

### Globals, outside the module boundary (P10-D9)

```
components/layout/app-header.tsx        from components/pos/app-header.tsx
components/layout/sync-badge.tsx        from components/pos/sync-badge.tsx
components/common/modal.tsx             from components/pos/modal.tsx   (deleted in Plan 03)
components/common/manager-override-dialog.tsx                             (sell + tender)
```

`manager-override-dialog.tsx` moves because `routes/_pos/sell.tsx` **and**
`routes/_pos/tender.tsx` both import it; leaving it inside one module forces that module to
re-export a component into a cycle, exactly the case Phase 8 hit twice.

### Routes become thin

| File | After |
|---|---|
| `routes/login.tsx` (632) | `export { LoginRoute } from '@/modules/auth'` plus the module's own wrapper. **The `window.location.hash = '#shift'` at line 27 moves into `modules/auth/pages/login-page.tsx`** — Plan 05 edits it there, not in the route file |
| `routes/shift.tsx` (292) | the same, for `@/modules/shift`. **The `window.location.hash = '#pos'` at line 193 moves into `modules/shift/pages/shift-page.tsx`** |
| `routes/_pos/app.tsx` (148) | unchanged in behaviour: the five-gate ladder, then `screen` → module page |
| `routes/_pos/sell.tsx` (541) | **deleted** — the body becomes `modules/sell/pages/sell-page.tsx` |
| `routes/_pos/tender.tsx` (387) | **deleted** → `modules/tender/pages/tender-page.tsx` |
| `routes/_pos/receipt.tsx` (264) | **deleted** → `modules/receipt/pages/receipt-page.tsx` |
| `routes/_pos/sales.tsx` (193) | **deleted** → `modules/sales/pages/sales-page.tsx` |
| `routes/_pos/sync.tsx` (254) | **deleted** → `modules/sync/pages/sync-page.tsx` |
| `routes/_pos/settings.tsx` (428) | **deleted** → `modules/settings/pages/settings-page.tsx` |
| `routes/_pos/dev-charts.tsx` | **stays** until Plan 05 retires it (exceptional file, written reason) |
| `routes/_pos/dev-sync.tsx`, `dev-print.tsx` | **stay** — diagnostics, not counter screens |

`_pos/app.tsx` keeps its head comment and its gate order verbatim; only the page imports change.
`main.tsx` keeps dispatching `login`, `shift`, `pos`, `dev/*`, `spike` — Plan 05 adds `home`.

### Composition rule (P10-D11)

`modules/sell/pages/sell-page.tsx` may import from `@/modules/{catalog,cart,customers,credit,loyalty}`
and `@/components/common` — six barrels, no internals. Each panel module owns its dialogs, so
the sell page no longer imports five dialogs directly (today it imports
`customer-dialog`, `customer-create-dialog`, `loyalty-redeem-dialog`, `discount-dialog`, and
`manager-override-dialog`).

`modules/catalog/index.ts` exports `CatalogBrowser` (search + grid + scan listener composed),
not the three pieces separately.

### What does not move

`lib/**` stays exactly where it is (D2): PowerSync provider/schema/connector, outbox, printing,
api clients, auth sessions, and every pure domain service. Those carry the passing tests and
the offline correctness of the system. `App.tsx` (the diagnostics shell) and `SpikePanel.tsx`
stay outside `modules/` because they are not counter screens; the README records that with the
reason.

### Barrels

Each `index.ts` exports only what another module or a page needs. Imports **inside** a module
are relative; imports **across** modules go through the barrel. The widened Biome rule from
Plan 01 fails the build on `@/modules/x/components/...`.

## Verification

```bash
bun run --filter desktop test
bun run --filter desktop check-types
bun run lint
bun run modules:check:pos
git diff -M --stat HEAD
```

Expected:

- every existing desktop test passes **unedited** (if a test needs changing, the move changed
  behaviour — stop and find out why);
- `check-types` and lint clean; Biome reports no `@/modules/*` deep import;
- `modules:check:pos` reports fixes for thirteen of fourteen pending modules, leaving `home`;
- `git diff -M` shows ~40 renames and no content changes beyond import specifiers;
- no className, no copy string, no SQL, and no money arithmetic differs.

## Commits

1. `refactor(desktop): components/layout and components/common for shared chrome`
2. `refactor(desktop): modules/auth and modules/shift with thin routes`
3. `refactor(desktop): modules/cart, catalog, and sell`
4. `refactor(desktop): modules/customers, credit, and loyalty`
5. `refactor(desktop): modules/tender, receipt, sales, sync, and settings`
6. `docs(desktop): record the route exemptions and the panels-own-dialogs rule`

## Done when

- `desktop/src/renderer/modules/` holds thirteen of the fourteen modules, each with only the
  folders it uses, and an `index.ts` barrel.
- Every `routes/**` file either routes, or is one of the four recordings exemptions
  (`_pos/app.tsx`, `dev-charts.tsx`, `dev-sync.tsx`, `dev-print.tsx`).
- `components/pos/` and `components/shift/` no longer exist.
- The desktop suite, types, lint, the Electron E2E, and `modules:check:pos` are green, with no
  screen visibly different.
