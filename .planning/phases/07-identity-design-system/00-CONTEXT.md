---
phase: 07-identity-design-system
name: Identity, Design System & Brand Foundation
depends_on: [01-foundation, 02-catalog-pricing, 03-inventory-transfers, 04-customers-credit, 05-suppliers-payables, 06-pos-offline-core]
requirements: [UIX-01, UIX-02, UIX-03, UIX-04, UIX-05]
status: planned
created: 2026-10-24
---

# Phase 7 — Identity, Design System & Brand Foundation — Locked Context

**Goal:** The product is called **Sceptre Drive** everywhere it is visible or load-bearing,
and both clients draw from one design-token source, one typography set, one primitive
library, and one date formatter — so the admin console and the POS cannot drift apart again.

This document records the decisions taken with the operator on 2026-10-24. It overrides
convenience in any later plan.

## Context: why this phase exists before payments

Phase 6 shipped a working offline POS whose design system is a copy of the admin's default
shadcn theme. The two clients duplicate the same 80 lines of CSS tokens, the admin has no
chart layer and hand-rolls its sidebar, the desktop has **no shadcn primitives at all** and
writes raw Tailwind in every screen, and the product is still named after the previous
brand in 215 files.

If Phases 11–12 (POS Payments, Admin Ops) are built first, every screen they add would be
written twice — once in the old visual language, once again in the new one. The operator
re-sequenced the roadmap on 2026-10-24 so the interface foundation lands first. Former
Phases 7, 8, and 9 became **11, 12, and 13** with scope unchanged.

## Locked Decisions

| # | Decision | Choice | Rationale |
|---|----------|--------|-----------|
| D1 | Phase boundary | Phase 7 delivers **identity, tokens, typography, primitives, date formatting, and the shell chrome pass** in both apps. It does **not** move admin pages into `modules/` (Phase 8), does **not** build analytics or charts-with-data (Phase 9), and does **not** restructure the POS screens into modules (Phase 10). Charts are installed and proven with static fixtures only | Keeps each phase independently verifiable; no phase mixes "moved" with "invented" |
| D2 | Rename mapping | `@gikautos/shared` → `@sceptre/shared`; `@gikautos/db` → `@sceptre/db`; root package `gikautos` → `sceptre-drive`; `GikAutos` → `Sceptre Drive`; `gikautos` → `sceptre-drive`; monogram `GA` → `SD`; app protocol host `app://gikautos` → `app://sceptre-drive`; POS SQLite files `gikautos-pos.db` → `sceptre-drive-pos.db`; device JWT audience `gikautos-pos` → `sceptre-pos`; logger service `gikautos-api` → `sceptre-drive-api`; Docker project `gikautos-dev` → `sceptre-drive-dev`; Postgres user/db `gikautos` → `sceptre_drive`; test db `gikautos_test` → `sceptre_drive_test`; PowerSync storage db `gikautos_powersync` → `sceptre_drive_powersync`; Squirrel maker name `gikautos_pos` → `sceptre_drive_pos`; emails `*@gikautos.local` → `*@sceptre.local`; CSP meta placeholder `%GIKAUTOS_CSP%` → `%SCEPTRE_CSP%`; Vite plugin name `gikautos-csp` → `sceptre-csp` | One mechanical sweep, one allowlist, one verification command. Mixed naming is worse than either name |
| D3 | Consequences accepted | The rename **invalidates every issued device JWT** and **moves Electron's `userData` directory** (it derives from `productName`). Development terminals must re-enrol and re-seed. Because v1 has not launched, no migration code is written; the consequence is documented in `desktop/README.md` instead | Writing a production migration for a pre-launch product adds risk with no benefit; hiding the consequence would strand the operator mid-verification |
| D4 | Domain hosts | The production API/PowerSync origins stay on the current placeholder domain. They move behind **one** `SCEPTRE_DOMAIN` constant (and its derived origin constants) so the eventual swap is a one-line change plus a test update | Operator decision 2026-10-24: the domain is not bought yet. Centralising now avoids a second sweep later |
| D5 | Allowlist | After the sweep, `grep -rIl 'gikautos'` may match **only**: `.planning/phases/01..06/**` (historical records), the `SCEPTRE_DOMAIN` placeholder constant and its test expectations, `api/migrations/**` (applied history is never rewritten), and `bun.lock` lockfile-free name comments if any. Everything else fails the phase | The allowlist is the verification. Without it, a partial rename passes review |
| D6 | Token architecture | One new workspace, **`packages/brand`**, owns `tokens.css` (light + dark custom properties and the Tailwind `@theme inline` mapping), `fonts.css`, and the woff2 assets. Both apps consume it with `@import "@sceptre/brand/tokens.css"` and delete their local token blocks. No app defines a brand hex value | A shared CSS import is enforced by the bundler; a "please keep these in sync" comment is not. `tw-animate-css` already proves package CSS imports resolve under `@tailwindcss/vite` |
| D7 | Palette | `--ink #1B1F23`, `--brand #F26A1B`, `--brand-fg #1B1F23` (text **on** brand), `--brand-ink #C25515` (brand **as** text), `--canvas #F6F6F4`, `--surface #FFFFFF`, `--line #E4E3DF`, `--muted-ink #5C6470`. Semantic: `--ok #1F7A4C`, `--warn #B45309`, `--danger #B42318`, `--info #1F5FA8`. Chart ramp in order: `#F26A1B`, `#1B1F23`, `#8A939F`, `#C97B3D`, `#2F6F6A`. Dark mode: canvas `#1B1F23`, surface `#22272C`, line `#333A41`, ink `#F6F6F4`, muted `#A8B0B9`, brand unchanged | Measured contrast (see research): charcoal-on-brand is **5.41:1** (AA), white-on-brand is **3.06:1** (fails AA for normal text, passes only as large text). Brand-as-text on white is 3.06:1, so it uses `--brand-ink` at **4.56:1** instead. Muted ink on canvas is 5.53:1; every semantic colour clears 5:1 on white. The palette is not re-derived per component — these are the only values |
| D8 | Typography | **Space Grotesk** (display: page titles, hero figures), **Inter** (UI: labels, tables, body), **JetBrains Mono** (all money, quantities, receipt/serial numbers, timestamps) with `font-variant-numeric: tabular-nums`. Self-hosted through `@fontsource-variable/*`, latin subset, `font-display: swap`, loaded from `packages/brand`. No Google Fonts CDN anywhere | Desktop CSP is `font-src 'self'`, so a CDN font is blocked in the packaged app. Measured: three variable families, latin-only woff2, ≈ 90 KB total |
| D9 | Primitive strategy | Install with the **shadcn CLI** (`bunx shadcn@latest add …`) into each app's `components/ui`. Admin canon: `#/components/ui`. Desktop gains `@/components/ui` for the first time. Both standardise on the `cn` package (already the admin's registry convention) and delete the duplicate `lib/utils.cn` helper. `chart.tsx` is copied from the registry, not hand-written | AGENTS.md rule 1: never hand-roll what a documented generator provides. The chart wrapper is ~350 lines of subtle Recharts integration; a hand-rolled version would fail on tooltip, theming, and SSR sizing |
| D10 | Charts | `recharts@^3.10` through the shadcn `chart` wrapper (`ChartContainer`, `ChartConfig`, `ChartTooltip`). Chart colours reference `var(--chart-N)` **directly** (Tailwind v4 tokens are complete colour values, so `hsl(var(--chart-N))` would break). `ChartContainer` always gets a height or `min-h-*`. Phase 7 proves the layer with static fixtures only; real data arrives in Phase 9 | Official shadcn guidance for Tailwind v4 + Recharts 3. Recharts 3.10.1 declares React 19 peer support |
| D11 | Dates | `date-fns@^4.4` installed in `@sceptre/shared`, `admin`, and `desktop`. All formatting goes through `packages/shared/src/dates.ts`: `formatDay`, `formatDateTime`, `formatTime`, `formatRelative`, `formatRange`, `formatBucket`, `formatCompactNumber`. Locale `en-GB` (the format Ghana retail expects: `24 Oct 2026`), timezone handled by the runtime (Africa/Accra is UTC+0 year-round). Bare `toLocaleDateString`/`toLocaleString`/`Intl.DateTimeFormat` for dates are removed from both apps | Operator instruction: "install and use date-fns to format all dates and times". A single helper set prevents `24/10/26` beside `Oct 24, 2026` on the same screen |
| D12 | Money formatting | Money stays integer pesewas. `formatGhs` remains the only money formatter and gains `tabular-nums` at the call site. Charts receive **minor units** and convert at the axis label, never in the data | AGENTS.md absolute rule 4. A chart that plots cedis as floats is a float in the money path |
| D13 | Motion | No new animation library. CSS transitions only, 150–200 ms, `ease-out`; `prefers-reduced-motion: reduce` disables transforms and count-ups globally. No GSAP in this phase | ui-ux-pro-max priority 7; the POS is a counter tool, not a marketing page. GSAP was considered and rejected as weight without purpose |
| D14 | Accessibility bar | WCAG 2.2 AA as the acceptance criterion: 4.5:1 body text, 3:1 large text and UI borders, visible focus ring on every interactive element (2 px `--brand` offset ring), 44×44 px minimum touch targets on the POS, keyboard-operable drawer and dialogs, `aria-label` on icon-only controls, `role="img"` + `aria-label` on every chart, no colour-only state | ui-ux-pro-max priorities 1–2; OWASP A06 (insecure design) treats accessibility as a design control |
| D15 | Verification contract | `bun lint`, `bun check-types`, `bun test` (API 354, shared 73+new, desktop 339+new), admin `bun run build`, desktop packaged smoke, plus a **token-parity check** (a unit test asserts both apps import the same token file and define no local brand hex), a **contrast check** (script asserts the palette pairs from D7), and the **grep allowlist** from D5. Evidence under `phases/07-identity-design-system/evidence/` | Goal-backward: "one design system" is provable, not assertable. A screenshot alone cannot prove tokens are shared |

## Architectural Invariants (do not violate)

- **One token source.** Neither app may declare a brand colour. App-local CSS may declare
  layout tokens (widths, z-index) only.
- **Charcoal on orange.** No white text on `--brand` for normal-size text, ever. If a
  design calls for white-on-orange, the design changes, not the contrast ratio.
- **The POS never stops selling.** Phase 7 touches CSS, copy, and primitives. Any change
  that alters cart, tender, sale, shift, credit, loyalty, stock, or outbox behaviour is a
  bug in this phase, and the desktop suite is the referee.
- **No remote assets.** Fonts, icons, and images are bundled. `font-src 'self'` is not
  widened, and the CSP gains no new origin.
- **Money is integer minor units.** Token and date work must not introduce a formatter that
  divides by 100 and returns a `number` to a chart series.
- **Applied migrations are history.** The rename never edits `api/migrations/**` text.
- **No secrets in the repo.** The rename touches `.env.example` only, never `.env`.

## Bootstrap Order

> **Execution notes:** load `frontend-design` + `ui-ux-pro-max` + `web-design-guidelines`
> before Plans 03, 04, and 06; `owasp-security` throughout (AGENTS.md mandate).

1. Workspace and package-scope rename (Plan 01).
2. Desktop identity: protocol host, product name, CSP constants, copy (Plan 02).
3. `packages/brand`: tokens, fonts, chart ramp (Plan 03).
4. shadcn primitives and the chart layer in both clients (Plan 04).
5. `date-fns` in shared, admin, and desktop (Plan 05).
6. Shell chrome on the new design system (Plan 06).
7. Verification, evidence, state update (Plan 07).

Plans 03–05 are independent after 01–02 and may run as one wave; Plan 06 depends on 03, 04,
and 05.

## Execution deviations

Plan 07's verification found three defects and one earlier-Plan test weakness, and made four
deliberate departures from the plan text. They are recorded in full in `01-VERIFICATION.md`
§6 and §7; the decisions that outlive the plan are:

| # | Decision | Why |
|---|---|---|
| E1 | Fonts are never inlined (`build.assetsInlineLimit` excludes font files in both apps) | A small `@fontsource` subset otherwise becomes a `data:` URI, which `font-src 'self'` blocks. Widening the policy to `data:` would weaken it for every font; D7's "no remote assets" stands |
| E2 | The mobile drawer suppresses nav tooltips | A tooltip opens on keyboard focus and is the innermost dismissable layer, so it consumed the first Escape. Labels are always visible in the drawer |
| E3 | The sync badge treats a downed transport as Offline when the terminal has synced before | Reporting `Downloaded 14:02` on a disconnected till tells a cashier that stock and prices are fresh when they are not. The `lastSyncedAt` guard keeps a first boot from flashing |
| E4 | The emitted bundle has two `--brand` declarations, not one | `:root` and `.dark` both declare it because D7 fixes the brand as unchanged in dark mode; both come from the one package file, which is the invariant `tokens:check` enforces |
| E5 | Walkthrough steps 8–9 run the unpackaged build | A packaged app sets `allowLocalOrigins: false` by design (a shipped terminal must never be pointable at a local impersonator), so it cannot reach a local API. Step 10 is the packaged binary |

Carry-forward found by the walkthrough, not fixed here: outbox rows that back off can be
overtaken by younger rows, so a sale can reach the server before its shift and be
dead-lettered `SHIFT_MISSING`. The till never blocks; **Phase 13** should enforce causal
ordering before payments ship.

## Open Items (carry into later phases)

- **Phase 8:** move admin pages into `modules/`, enforce the import boundary, rebuild the
  sidebar as a `sidebar` primitive with grouped permission-filtered sections.
- **Phase 9:** wire the chart layer to the analytics read models; period/branch controls;
  the Till Line; demo sales seed.
- **Phase 10:** move POS screens into `modules/`, build `#home`, and sweep the primitive set
  across every counter screen.
- **Phase 13:** POS screens are written once, in the Phase 7 tokens and Phase 10 modules —
  no double implementation.
- **Domain purchase:** replace `SCEPTRE_DOMAIN`, update CSP tests, `.env.example`, and the
  PowerSync config in the same commit.
- **Brand assets:** no logo file exists yet. The monogram `SD` in Space Grotesk is the
  placeholder mark; a real logo is a design task outside this phase's code scope.
