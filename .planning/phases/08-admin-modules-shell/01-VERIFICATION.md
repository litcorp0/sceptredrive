# Phase 8 — Verification

**Goal:** every admin screen is assembled inside a domain module and the route file only routes,
so a feature can be understood, tested, and changed without reading the router.

**Requirements:** UIX-06, UIX-07.
**Verified:** 2026-10-24.
**Result:** **passed** — 14/14 modules migrated, the strict architecture gate is green, and the
console was walked section by section in a real browser against the demo seed.

---

## 1. Roadmap criteria → proof

| # | Success criterion | Proof |
|---|---|---|
| 1 | `admin/src/modules/` contains every domain, each with the seven folders | `bun run modules:check` module table: 14 migrated, `analytics` deferred to Phase 9. Folders are created only where content exists (D2), so no module has an empty one. |
| 2 | Every file under `admin/src/routes/` is a thin route | 53 route files, **780 lines total** (was 9,770). Every route that owns a body is ≤ 25 lines and imports exactly one barrel; the three exemptions are named in the gate with reasons. |
| 3 | A module cannot reach into another's internals; Biome fails otherwise | `noRestrictedImports` group `#/modules/*/*` + `#/modules/*/*/**` proven by mutation 5 (deep import) and 6 (self-alias); `admin/src/modules/README.md` records why the rule cannot be importer-aware and why intra-module imports are relative. |
| 4 | The shell is role-aware: permission-filtered nav, manager-locked branch context, keyboard drawer, skip link | `walkthrough-sections.mjs` manager leg (locked badge, no "All branches", foreign `branchId` ignored, staff list hides admins) + `capture-shell.mjs` **16/16** (groups, active rail, fascia, skip link, focus ring, print, dark persistence, 375 px drawer with a single Escape). |
| 5 | No behaviour change | 32 sections + 7 detail screens + statement render with their own data; 49/49 checks; zero console errors and zero failed requests outside two documented pre-existing cases. |

## 2. Gate matrix

| Gate | Result |
|---|---|
| `bun run lint` | clean — 24 warnings, all pre-existing, none in `admin/src` |
| `bun run modules:check:strict` | **OK — 14/14 modules migrated**, zero outstanding targets |
| `bun run brand:check` / `bun run tokens:check` | pass |
| `bun run check-types` | 6/6 |
| `bun run test` | API **360**, shared **96**, desktop **339** — unchanged from the Phase 7 baseline |
| `bun run build` | admin SSR + client and desktop package pass |
| `admin/test/walkthrough-sections.mjs` | **49/49** |
| `evidence/capture-shell.mjs` | **16/16** |
| `evidence/verify-module-gate.mjs` | **20/20** (12 mutations, all restored byte-for-byte) |

Structural before/after:

| Measure | Before | After |
|---|---|---|
| `admin/src/routes` total lines | 9,770 | **780** |
| Largest route that owns a body | `staff.tsx` 742 | `login.tsx` 25 |
| `lib/api.ts` | 651 (transport + 15 domain groups) | **102** (transport only) |
| `lib/api-types.ts` | 1,485 | **deleted**, zero importers |
| Domain component folders | 7 (`components/<domain>/`, 64 files) | **0** — only `ui`, `common`, `layout` remain |
| Inline `queryKey:` sites in routes | 79 | **0** |

## 3. What the walkthrough covers

Admin leg: `/`, `/branches`, `/terminals`, `/staff`, `/catalog/products`, `/catalog/products/new`,
`/catalog/categories`, `/catalog/brands`, `/catalog/units`, `/inventory/stock`,
`/inventory/receipts`, `/inventory/transfers`, `/inventory/transfers/new`, `/inventory/counts`,
`/inventory/counts/new`, `/customers`, `/customers/aging`, `/loyalty`, `/suppliers`,
`/suppliers/invoices`, `/suppliers/invoices/new`, `/suppliers/payments`, `/suppliers/aging`,
`/audit`, `/settings` — plus branch, product, stock, receipt, supplier, invoice, payment and
customer detail screens and a customer statement.

Manager leg: forced password change completes, lands on the dashboard, branch control is a locked
badge with no "All branches", the six branch-scoped screens open, a foreign `branchId` in the URL
changes nothing, and the staff list does not show admin accounts.

Each visit asserts: the route actually resolved, the expected section copy is present, the page
contains no error copy, the console logged no error, and no request failed. That last pair is how a
barrel cycle would surface — a component exported through a cycle resolves to `undefined` and React
throws on render.

Screenshots: `evidence/shots/plan08-admin-{light,dark,mobile-drawer,dashboard}.png`.

## 4. Deliberate deviations

1. **Ordering (from research §7).** credit → loyalty → customers rather than the context's
   customers/credit grouping, and suppliers before payables, because the 470-line customer detail
   route composes all three and because suppliers+payables is 9 routes and 19 components.
2. **The dashboard moved early** (Plan 12 → Plan 03). Its staff count read `api.staff`, so the
   staff group could not be deleted without it. It is a 74-line move carrying a `TODO(phase-9)`.
3. **No `hooks/` in staff.** Its four mutations each close over one component's local state, so
   extracting them would have been a rewrite (D9), and D2 forbids an empty folder. `hooks/` appears
   where logic is genuinely shared.
4. **`analytics` is not pending, it is deferred.** The gate keeps it in a separate map naming Phase
   9, so "PENDING_MODULES is empty" means "Phase 8 is done" rather than "fifteen modules exist".
5. **The gate judges a route by its body, not by its imports.** Plan 07 required flipping the
   customer detail route's imports to `#/modules/credit` while leaving its 470-line body for Plan
   09. The first gate draft called that a violation; it now reports an over-long route as
   outstanding work and fails only the strict run.
6. **Two component cycles were broken by moving shared pieces to `components/common`**
   (`supplier-combobox`, `product-picker`, `invoice-status-badge`). Each is used by more than one
   domain and each would otherwise have made a barrel re-export a component into a cycle.
7. **`inventory ↔ payables` and `suppliers ↔ payables` remain two-way *data* edges**, documented in
   `admin/src/modules/README.md`. Neither imports the other's components.

## 5. Defects found

### Fixed in this phase

- **Loyalty adjust dialog imported the customers module's key**, which made
  `loyalty → customers → loyalty` a cycle. It invalidates the same key literally, with the reason
  recorded.
- **`api.staff.changeOwnPassword` was dead** (the auth module owns that call); deleted with its
  duplicate `ChangePasswordInput`.
- **The gate counted redirect-only and pass-through routes as unfinished work**, so
  `catalog/index.tsx` and three parent routes would never clear. Both shapes are now complete by
  definition and checked for thinness only.
- **The gate exempted nothing for the authenticated shell layout**, which is infrastructure rather
  than a domain page. Exemptions are now keyed by path, so a section layout cannot inherit one.

### Found, not fixed (carry-forwards)

| Defect | Where | Why not here |
|---|---|---|
| SSR hydration mismatch on `/inventory/transfers/new` | inventory transfer-new page | Pre-existing: the page body is byte-identical to the pre-Phase-8 route (diffed). A hydration bug is not a refactor and needs its own decision. |
| The shell's branch provider requests `/api/branches` for every role, so a manager always gets one 403 | `lib/branch-context.tsx` | Pre-existing and cosmetic (the manager's branch comes from the session), but it is a pointless request per page load. |
| `["supplier-balances"]` is never invalidated after a payment | payables | Pre-existing; the supplier list's Owed column can go stale when both screens are open. |
| `receipts/$receiptId` computes `quantity × unitCostMinor` in the client | inventory receipt detail | Pre-existing money arithmetic; the repo rule says the server owns that figure. |
| Invoice detail renders the raw `allocation.method` enum (`"BANK"`) | payables | Pre-existing; the fix is a label map, i.e. a behaviour change. |
| `CreditStatement.entryKind` display maths in the credit ledger | credit | Pre-existing display-only arithmetic over money. |
| `dev-charts.tsx` (315 lines) is still a route | routes | Phase 9 deletes it with the real dashboard. |

## 6. Human checks recorded

- Signed in as admin and as manager against `db:seed --demo`; every section listed in §3 opened
  with its own data (product, branch, terminal, receipt, supplier, invoice, payment and customer
  records were opened from their lists, not by guessing ids).
- The manager's forced password change was exercised for real; the new password is written to
  `/tmp/opencode/manager-password.txt` so the walkthrough is re-runnable.
- The managed dev server on `:3000` and API on `:4000` served every check; the sealed production
  build was verified separately by `bun run build`.

## 7. Carry-forwards into later phases

- **Phase 9:** delete `dev-charts.tsx`; create `modules/analytics`; rewrite
  `modules/dashboard/pages/dashboard-page.tsx` behind its existing barrel.
- **Phase 11:** decide whether `inventory ↔ payables` should become one-way through a shared read
  layer (needs a design decision, not a refactor).
- **Phase 12:** nav badges and approval counts extend `NAV_GROUPS` in
  `components/layout/sidebar.tsx`, which is unchanged by this phase.
- **Phase 14:** `modules/pos-oversight` is a new module; the layout, gate and barrel conventions
  already accommodate it.
- `STAFF_ID_PREFIX=GA` remains an operator decision (carried from Phase 7).
