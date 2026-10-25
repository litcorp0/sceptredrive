---
phase: 10-desktop-pos-redesign
name: Desktop POS Modules, Chrome & Shift Home
depends_on: [06-pos-offline-core, 07-identity-design-system, 08-admin-modules-shell, 09-analytics-dashboard]
requirements: [UIX-08, UIX-09]
status: context-locked
created: 2026-10-24
---

# Phase 10 — Desktop POS Modules, Chrome & Shift Home — Locked Context

**Goal:** The terminal wears the same brand as the console, opens on a shift dashboard that
answers "how is today going?", and still sells with the network unplugged.

## Locked Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Module inventory | `modules/{home, sell, cart, catalog, customers, credit, loyalty, tender, shift, sales, receipt, sync, settings, auth}` with `api/`, `components/`, `hooks/`, `pages/`, `types/`, `ui/`, `utils/`, plus an `index.ts` barrel | Mirrors the admin (Phase 8) so one mental model covers both clients |
| D2 | What stays in `lib/` | PowerSync provider/schema/connector, outbox, printing, api clients, auth sessions, and the pure domain services (cart reducer, totals, sale, credit headroom, loyalty quote, discounts, overrides, receipt render) | Those carry 339 passing tests and the offline correctness of the system. Moving them buys nothing and risks the one thing that must not break |
| D3 | Route shape | A hash route resolves to a module page. `routes/_pos/app.tsx` keeps the guard ladder (no DB → no staff → no config → no shift → settings permission) exactly as it is, then renders a page | The guards are behaviour; the pages are presentation |
| D4 | Home screen data source | Local SQLite through PowerSync queries — same source as the sales screen. No API call on the home screen. It must be fully correct with the network unplugged | A dashboard that needs the internet is useless at a counter |
| D5 | Home screen content ¹ | Shift at a glance: today's take, cash in drawer (expected), credit given today, items sold, average basket, a 24-hour sales bar chart, top five sellers today, and a needs-attention strip (unprinted receipts, open sync conflicts, low-stock items, pending uploads). One primary action: **Start selling** | Operator requirement: a sleek dashboard, not a new step in front of selling |
| D6 | Home is never a gate ² | Signing in with an open shift lands on home; the sell screen is one click or one keyboard shortcut away (F2 or the primary button). A closed shift or `salesRequireOpenShift` routes to `#shift` as today; home is reachable but selling is not blocked by it | AGENTS.md: never block a sale at the till |
| D7 | Adoption of primitives | All POS screens move to `components/ui` primitives and the Phase 7 tokens. The hand-written `Modal` becomes the generated `Dialog`. Raw `rounded-md border border-border` buttons become `Button` variants | The desktop currently has zero primitives, which is why it drifted |
| D8 | Counter ergonomics | Touch targets ≥ 44×44 px, primary action ≥ 56 px tall, no hover-only affordance, tab order follows the visual order, visible focus ring on every control, and no animated layout on the selling path | A counter is a touch screen and a keyboard at the same time |
| D9 | Density | Denser than the admin: 4 px spacing scale steps, 11–13 px captions, tabular figures on every amount. The POS is read at arm's length, not from a desk | Counter distance and gloves change what is legible |
| D10 | Copy | Same voice as the admin: active voice, plain verbs, sentence case. Offline is a normal state ("Offline — 3 sales waiting"), never an error. Error copy names what happened and what to do | Matches Phase 7's writing rules; cashiers are not developers |
| D11 | Charts on the POS | Recharts through the shared `chart` wrapper, importing only the area/bar primitives used. Bundle delta measured and recorded; if the renderer bundle grows more than 250 KB, the home chart is replaced with a CSS bar strip rather than accepting the weight | Electron ships the bundle to every terminal; POS boot time matters more than chart variety |
| D12 | No behaviour change | Cart, tender, sale completion, shift arithmetic, credit, loyalty, outbox, printing, and conflict handling are untouched. The suite is the referee: desktop 339, Electron E2E 51, offline walkthrough, packaged shell 38, packaged print 21 | A failing test after a redesign is a regression in the redesign |
| D13 | Verification ³ | All suites above pass; every screen is exercised at 1024×768 (the smallest supported counter screen) and 1920×1080; offline relaunch still works; the home screen is correct with the network down; screenshots per screen in both themes | Goal-backward: "the POS still sells offline and looks like Sceptre Drive" |

¹ Amended in execution by P10-D1 (the figures are *this terminal's* day, and say so), P10-D2
(*out of stock now* replaces the low-stock item, because `stock_threshold` is not synced) and
P10-D4 (no tender mix: a CASH tender row contains the change handed back).
² Refined by P10-D6 (`#home` is a new top-level route beside `#pos`, not a redefinition of it)
and P10-D7 (F2 means *find an item* on both screens).
³ Amended by P10-D8: the POS has no dark theme, so the matrix runs **light only** at three
widths and under `prefers-reduced-motion: reduce`.

## Invariants

- **The till never blocks.** Nothing on the home screen or in the new chrome may gate,
  delay, or interrupt a sale.
- Offline is normal. No new error styling for a state the POS is designed to operate in.
- Integer money. Every figure on the home screen comes from local rows already computed by
  the shared pure functions; the home screen does not invent a new total.
- No remote assets; CSP unchanged (fonts and charts are bundled).
- Local data stays local: nothing on the home screen triggers an upload or a sync.

## Open Items

- The Phase 7 `dev-charts` route is deleted once the home screen ships.
- Phase 11 (procurement and replenishment) and Phase 12 (branch approvals) reuse the module
  layout, the primitives, and the chart layer established here.
- Phase 13 (payments, returns, X/Z reports) builds on the module layout and the primitives
  established here, so those screens are written once.
- Physical hardware verification (80 mm printer, scanner, drawer) stays a human step in
  Phase 15.

---

## Amendments (2026-10-25)

`00-DECISIONS.md` holds the reasoning; this table is the index. Where a refinement contradicted
the locked table above, the refinement won and the row carries a footnote.

| # | Decision | Why, in one line | Implemented |
|---|---|---|---|
| P10-D1 | Every home figure is this terminal's Accra day, and the heading says so | `sale` is local-only, so a branch figure would be a lie offline | Plans 04, 05 |
| P10-D2 | The attention strip reports *out of stock now*, not low stock | `stock_threshold` is a server table and is not in any sync stream | Plans 04, 05 |
| P10-D3 | `averageBasketMinor` lands in `@sceptre/shared` and both clients call it | Two roundings of the same rule is how a till and a dashboard disagree | Plan 01 (+ API follow-up) |
| P10-D4 | The counter shows no tender mix | A `CASH` tender row stores what was handed over, not what the till kept | Plan 05 |
| P10-D5 | Take is a day window; the drawer is the open-shift window; both are labelled | After a close and reopen the two legitimately differ | Plan 04 |
| P10-D6 | `#home` is a top-level route beside `#pos`; the guard ladder does not move | `#pos` already means *selling* in nine places and in the E2E | Plan 05 |
| P10-D7 | F2 keeps one meaning: *find an item* | A key that changes meaning under the cashier's hands is learned twice | Plans 05, 06 |
| P10-D8 | Verification is light-mode only | The renderer never applies `.dark` and has no theme toggle | Plan 09 |
| P10-D9 | `components/layout` and `components/common` stay global | A shared component inside one module forces a barrel cycle | Plan 03 |
| P10-D10 | In a desktop module, `api/` means the local data source | One mental model for both clients; `ui/` may not query | Plan 02 |
| P10-D11 | One owning component per module; panels own their dialogs | Five sibling internals from `sell` is the cycle Phase 8 hit twice | Plan 06 |
| P10-D12 | Watch queries are day-bounded, throttled at 250 ms, and indexed | The SDK's own guidance: watched queries must be cheap to re-run | Plans 01, 04 |
| P10-D13 | The Accra day rolls over while the app is open | A till left open across midnight would show yesterday as today | Plan 04 |
| P10-D14 | Phase 9's chart rules apply at counter distance | A gloved cashier at 1024 px is a harder reader than a manager at a desk | Plan 05 |
| P10-D15 | A local schema change is proven on a database that already has sales | Discovering a migration fault on a till holding a day of trading is the failure to avoid | Plan 01 |
