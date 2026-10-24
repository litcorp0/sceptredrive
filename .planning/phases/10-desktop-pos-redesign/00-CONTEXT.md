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
| D5 | Home screen content | Shift at a glance: today's take, cash in drawer (expected), credit given today, items sold, average basket, a 24-hour sales bar chart, top five sellers today, and a needs-attention strip (unprinted receipts, open sync conflicts, low-stock items, pending uploads). One primary action: **Start selling** | Operator requirement: a sleek dashboard, not a new step in front of selling |
| D6 | Home is never a gate | Signing in with an open shift lands on home; the sell screen is one click or one keyboard shortcut away (F2 or the primary button). A closed shift or `salesRequireOpenShift` routes to `#shift` as today; home is reachable but selling is not blocked by it | AGENTS.md: never block a sale at the till |
| D7 | Adoption of primitives | All POS screens move to `components/ui` primitives and the Phase 7 tokens. The hand-written `Modal` becomes the generated `Dialog`. Raw `rounded-md border border-border` buttons become `Button` variants | The desktop currently has zero primitives, which is why it drifted |
| D8 | Counter ergonomics | Touch targets ≥ 44×44 px, primary action ≥ 56 px tall, no hover-only affordance, tab order follows the visual order, visible focus ring on every control, and no animated layout on the selling path | A counter is a touch screen and a keyboard at the same time |
| D9 | Density | Denser than the admin: 4 px spacing scale steps, 11–13 px captions, tabular figures on every amount. The POS is read at arm's length, not from a desk | Counter distance and gloves change what is legible |
| D10 | Copy | Same voice as the admin: active voice, plain verbs, sentence case. Offline is a normal state ("Offline — 3 sales waiting"), never an error. Error copy names what happened and what to do | Matches Phase 7's writing rules; cashiers are not developers |
| D11 | Charts on the POS | Recharts through the shared `chart` wrapper, importing only the area/bar primitives used. Bundle delta measured and recorded; if the renderer bundle grows more than 250 KB, the home chart is replaced with a CSS bar strip rather than accepting the weight | Electron ships the bundle to every terminal; POS boot time matters more than chart variety |
| D12 | No behaviour change | Cart, tender, sale completion, shift arithmetic, credit, loyalty, outbox, printing, and conflict handling are untouched. The suite is the referee: desktop 339, Electron E2E 51, offline walkthrough, packaged shell 38, packaged print 21 | A failing test after a redesign is a regression in the redesign |
| D13 | Verification | All suites above pass; every screen is exercised at 1024×768 (the smallest supported counter screen) and 1920×1080; offline relaunch still works; the home screen is correct with the network down; screenshots per screen in both themes | Goal-backward: "the POS still sells offline and looks like Sceptre Drive" |

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
