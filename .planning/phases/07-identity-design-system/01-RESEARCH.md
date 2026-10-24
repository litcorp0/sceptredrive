---
phase: 07-identity-design-system
plan: research
title: Verified versions, contrast measurements, and rename blast radius
status: complete
created: 2026-10-24
---

# Phase 7 Research — Identity, Design System & Brand Foundation

Everything here was checked on 2026-10-24 against the official source named in each
section. Where a claim could not be confirmed, it says so and is treated as a risk.

## 1. Library versions

| Package | Version verified | Notes |
|---|---|---|
| `recharts` | **3.10.1** | Peer deps declare `react ^16.8 \|\| ^17 \|\| ^18 \|\| ^19` — React 19.2 is supported |
| `date-fns` | **4.4.0** | Named exports only; `format`, `formatDistanceToNow`, `parseISO`, `startOfWeek`, `eachDayOfInterval` all present |
| `@fontsource-variable/space-grotesk` | **5.3.0** | Variable weight axis 300–700 |
| `@fontsource-variable/inter` | **5.3.0** | Variable 100–900, `opsz` axis |
| `@fontsource-variable/jetbrains-mono` | **5.3.0** | Variable 100–800, supports `tnum` |
| `cn` | `^0.5.0` (already installed in admin) | shadcn's Tailwind class-merge engine; replaces `tailwind-merge` + `clsx` with the same API |

The shadcn `chart` registry item declares `"dependencies": ["cn", "recharts@3.8.0",
"lucide-react"]`. Installing `recharts@^3.10` first and letting the CLI keep the newer
version is preferred over taking the registry's older pin.

## 2. shadcn chart layer (Tailwind v4 + Recharts 3)

From `https://ui.shadcn.com/docs/components/base/chart` and the registry JSON
(`/r/styles/new-york-v4/chart.json`):

- **Use `var(--chart-1)`, not `hsl(var(--chart-1))`.** In Tailwind v4 the token is already a
  complete colour value. Wrapping it in `hsl()` produces an invalid colour and the series
  renders black or transparent. This is the single most common breakage.
- `ChartContainer` must have a height, `min-h-*`, or `aspect-*`, otherwise
  `ResponsiveContainer` measures zero on first render and the chart is invisible until a
  resize. The registry component exposes `initialDimension` for SSR sizing — use it in the
  admin (TanStack Start renders on the server) so the first paint is not empty.
- `ChartTooltip` must not disable focus behaviour; Recharts moves focus between data points
  and opens the tooltip on focus, which is what makes the chart keyboard-readable.
- The wrapper is ~350 lines. It is copied, never hand-written.

**Chart choice** (from `ui-ux-pro-max` `chart` domain):
- Trend over time → **area/line**; differentiate series by style as well as colour; fill at
  ~20% opacity.
- Composition of a total (tender mix) → **stacked bar**, not a pie; pies are hard to compare
  and fail for more than five slices.
- Ranking (top products, branches) → **horizontal bar**.
- Single KPI against a target → bullet/progress, values always visible as text.
- Every chart needs a labelled axis, a legend, a visible summary sentence, and a data-table
  fallback. Colour alone may never carry meaning.

## 3. Contrast measurements (computed, not estimated)

WCAG relative luminance, sRGB, white reference:

| Pair | Ratio | Verdict |
|---|---|---|
| `#1B1F23` on `#F26A1B` | **5.41:1** | AA body text ✔ — this is the primary button |
| `#FFFFFF` on `#F26A1B` | 3.06:1 | AA **large text only** ✘ for body — rejected |
| `#F26A1B` on `#FFFFFF` | 3.06:1 | ✘ for body text — use `--brand-ink` instead |
| `#C25515` on `#FFFFFF` | **4.56:1** | AA body text ✔ — brand as text |
| `#1B1F23` on `#F26A1B` (dark-mode accent) | 5.41:1 | ✔ |
| `#F26A1B` on `#1B1F23` | 5.41:1 | ✔ |
| `#1B1F23` on `#F6F6F4` | 15.32:1 | ✔ AAA |
| `#5C6470` on `#F6F6F4` | **5.53:1** | ✔ AA — muted text |
| `#5C6470` on `#FFFFFF` | 5.98:1 | ✔ AA |
| `#8A939F` on `#FFFFFF` | 3.11:1 | ✘ for text; **borders and the third chart series only** |
| `#8A939F` on `#1B1F23` | 5.33:1 | ✔ in dark mode |
| `#F6F6F4` on `#1B1F23` | 15.32:1 | ✔ AAA dark mode |
| `#C9CDD3` on `#1B1F23` | 10.39:1 | ✔ dark-mode border |
| `#1F7A4C` on `#FFFFFF` | 5.32:1 | ✔ success |
| `#B45309` on `#FFFFFF` | 5.02:1 | ✔ warning |
| `#B42318` on `#FFFFFF` | 6.57:1 | ✔ danger |
| `#1F5FA8` on `#FFFFFF` | 6.44:1 | ✔ info |

**Consequence:** the operator's brand orange cannot carry white text at body size. The
design uses charcoal-on-orange. This is a design constraint produced by measurement, not a
style preference, and Plan 06 must not "fix" it.

## 4. Self-hosted fonts under the desktop CSP

`desktop/src/main/csp.ts` sets `font-src 'self'`. A Google Fonts `<link>` or `@import url()`
is therefore **blocked in the packaged app** — it would work in dev and fail silently on a
customer terminal. Fonts must be bundled.

`@tailwindcss/vite` already resolves package CSS imports in this repo: the admin's
`styles.css` imports `tw-animate-css` from `node_modules`. The same mechanism carries
`@import "@sceptre/brand/tokens.css"` and the fontsource CSS, so both apps get hashed,
same-origin asset URLs in dev and in the build.

Measured cost of the three latin variable fonts: roughly 90 KB total (woff2), loaded with
`font-display: swap` so a cold POS boot never waits on type.

## 5. `date-fns` v4

- Named exports only (`import { format } from "date-fns"`); no default export, which suits
  this repo's `verbatimModuleSyntax`.
- `format(date, "d MMM yyyy")` → `24 Oct 2026`, the format Ghana retail receipts and
  statements already use (`formatDay` in `admin/src/lib/format.ts`).
- `differenceInCalendarDays`, `eachDayOfInterval`, `startOfWeek`, `startOfMonth`,
  `endOfMonth`, `isSameDay` cover the period pickers Phase 9 needs.
- Africa/Accra is UTC+0 all year with no DST, so no `@date-fns/tz` dependency is needed;
  `toZonedTime` would be redundant. Document this so a later phase does not add it "just in
  case".
- Existing hand-rolled date formatting to remove: `admin/src/lib/format.ts:formatDay`,
  `new Date(...).toLocaleString()` in `routes/_authenticated/index.tsx`, and any
  `toLocaleDateString` in the credit/payables/loyalty tables.

## 6. Rename blast radius (measured)

`grep -ril gikautos` excluding `node_modules`, `.git`, `.output`, `out`, `dist`:

- **215 files**, across `api/src`, `admin/src`, `desktop/src`, `packages/*`, `.planning`,
  `scripts`, `.github`, `compose.yaml`, `package.json`, `.env.example`, `README`/`AGENTS`.

Distinct token classes that must be handled separately (a blind case-insensitive replace
gets several of these wrong):

| Class | Example | Replacement | Hazard |
|---|---|---|---|
| Package scope | `@gikautos/shared`, `@gikautos/db` | `@sceptre/shared`, `@sceptre/db` | Requires `bun install` to relink workspaces and rewrite `bun.lock` |
| Root package | `"name": "gikautos"` | `"name": "sceptre-drive"` | none |
| Product name | `GikAutos POS`, `GikAutos Admin` | `Sceptre Drive POS`, `Sceptre Drive Admin` | Moves Electron `userData` |
| Slug | `gikautos-dev`, `gikautos-postgres` | `sceptre-drive-dev`, `sceptre-drive-postgres` | Docker volumes are recreated |
| SQL identifiers | user/db `gikautos`, `gikautos_test`, `gikautos_powersync` | underscore form `sceptre_drive*` | Existing local DB must be reseeded |
| Protocol host | `APP_HOST = 'gikautos'`, `app://gikautos` | `sceptre-drive` | `paths.test.ts` asserts the URL; CSP tests assert origins |
| JWT audience | `DEVICE_TOKEN_AUDIENCE = 'gikautos-pos'` | `'sceptre-pos'` | **Invalidates every issued device token** — enrolled terminals must re-enrol |
| DB filenames | `gikautos-pos.db`, `gikautos-spike-*.db` | `sceptre-drive-*` | Local POS data is orphaned (acceptable pre-launch) |
| Logger service | `service: 'gikautos-api'` | `sceptre-drive-api` | Log dashboards reference it |
| Email domain | `admin@gikautos.local`, `no-reply@gikautos.local` | `*@sceptre.local` | Seed users change; dev login credentials change |
| Squirrel name | `gikautos_pos` | `sceptre_drive_pos` | Windows install path |
| CSP placeholder | `%GIKAUTOS_CSP%` | `%SCEPTRE_CSP%` | Test asserts the placeholder is replaced |
| Vite plugin name | `gikautos-csp` | `sceptre-csp` | cosmetic |
| Monogram | `GA` | `SD` | cosmetic |
| Domain hosts | `api.gikautos.com`, `*.gikautos.com` | **unchanged** | Deferred by D4; centralised into `SCEPTRE_DOMAIN` |

Files with exact-string assertions that will catch a partial rename: `desktop/src/main/
csp.test.ts`, `desktop/src/main/paths.test.ts`, `desktop/src/main/config.test.ts`,
`desktop/src/renderer/lib/powersync/*.test.ts`, and `api/test/setup.ts` (DB name).

## 7. Biome import boundaries (for Phase 8, proven here)

`noRestrictedImports` supports `patterns` with **gitignore-style globs** and a per-group
`message` since Biome **2.2.0**; this repo pins Biome **2.4.5**, so the rule is available.
The Phase 8 boundary rule restricts `#/modules/*/components/**`, `#/modules/*/ui/**`, and
`#/modules/*/hooks/**` from outside their own module while allowing `#/modules/<name>` (the
barrel). Plan 04 only needs to confirm the rule loads and fails correctly on a probe.

## 8. shadcn CLI in this monorepo

Each app has its own `components.json` with different aliases (admin `#/`, desktop `@/`).
Running the CLI **from inside each workspace directory** lets it read that app's config and
write to that app's `components/ui`, which is what the registry's alias resolution expects.
No monorepo `components.json` is introduced — two independent consumers, two configs, one
registry.

Admin already depends on `cn`, which is what the new registry items import from. The desktop
has a hand-written `cn` in `lib/utils.ts`; Plan 04 adds the `cn` package there and removes
the duplicate so both apps resolve class merging the same way.

## 9. Verified current state (what the plans will change)

| Fact | Value | Implication |
|---|---|---|
| Admin route files | 8,682 lines, largest 742 (`staff.tsx`) | Pages are inside routes today; Phase 8 moves them |
| Desktop route+component files | 6,380 lines, largest 632 (`login.tsx`) | Phase 10 moves them |
| Admin `components/ui` | 17 files, no `chart`, no `sidebar` | Plan 04 adds both |
| Desktop `components/ui` | **does not exist** | Plan 04 creates it |
| Design tokens | duplicated verbatim in `admin/src/styles.css` and `desktop/src/renderer/index.css` (80 lines each) | Plan 03 replaces both with one import |
| Chart tokens | `--chart-1..5` already declared (blue/green/yellow/purple/red defaults) | Plan 03 overwrites with the brand ramp |
| `date-fns` | not installed anywhere | Plan 05 adds it |
| Role permissions | 54 permissions, no analytics/report permission | Phase 9 adds `analytics.read` |
| Branch scope helpers | `branchScope`, `assertBranchAccess`, `resolveBranchFilter` in `api/src/auth/scope.ts` | Phase 9 reuses; no new auth machinery |
| Analytics API | does not exist (`pos` exposes only `/api/pos/reconciliation`) | Phase 9 builds it |
| `sale` indexes | `(branch_id, occurred_at)`, `(terminal_id, occurred_at)`, `(customer_id, occurred_at)`, `(shift_id)` | Phase 9 aggregates are index-supported; no migration |

## 10. Risks and mitigations

| Risk | Evidence | Mitigation |
|---|---|---|
| Partial rename passes review | 215 files, 15 token classes | Single sweep + allowlist grep gate (D5) + full suite in Plan 07 |
| Chart renders blank | `hsl(var(--chart-1))` misuse, zero-height container | Plan 04 ships a fixture chart and asserts it renders with a measured height in a test |
| Fonts load in dev, fail packaged | CSP `font-src 'self'` | Plan 03 bundles via fontsource; Plan 07 runs the packaged shell smoke |
| Token drift creeps back | Both apps currently duplicate tokens | Plan 07 adds a test that fails if either app declares a brand hex |
| `cn` migration breaks desktop classes | Desktop `cn` is hand-written, identical signature | Same API; desktop suite + visual pass |
| Device tokens invalidated | JWT `aud` change | Documented in D3; dev re-enrolment is part of Plan 07's walkthrough |
| Recharts bundle growth in POS | 3.10 tree-shakes per chart import | Phase 10 imports only area/bar primitives; POS budget reviewed then |
