---
phase: 07-identity-design-system
plan: 04
wave: 2
title: shadcn primitives and the chart layer in both clients
requirements: [UIX-04]
depends_on: [01, 03]
status: planned
created: 2026-10-24
---

# Plan 04 — shadcn Primitives and the Chart Layer

**Goal:** Both clients own the same generated primitive set, including a real `chart`
wrapper and a real `sidebar`, installed with the official CLI — no hand-written dialog,
table, or SVG chart code anywhere.

## Task 1 — Admin: add the missing primitives

**Files:** `admin/components.json` (if the CLI adjusts it), `admin/src/components/ui/**`,
`admin/src/hooks/use-mobile.ts`, `admin/package.json`

- Run from inside the admin workspace so the CLI reads its own `components.json`
  (`#/components` aliases):
  ```bash
  cd admin
  bunx shadcn@latest add chart sidebar tooltip toggle-group popover calendar command \
    avatar scroll-area breadcrumb collapsible empty
  ```
- Existing primitives (`button`, `card`, `table`, `badge`, `dialog`, `alert-dialog`,
  `dropdown-menu`, `input`, `label`, `select`, `separator`, `sheet`, `skeleton`, `switch`,
  `tabs`, `textarea`, `sonner`) are **not** touched — no regeneration, no style drift.
- The CLI adds `recharts` and `cn` and creates `admin/src/hooks/use-mobile.ts` (the sidebar
  registry dependency). Accept both; pin `recharts` to `^3.10.1` afterwards if the registry
  wrote an older exact version.
- If the CLI rewrites `components.json`, keep the existing alias block byte-identical.

**Verify:** `bun run --filter admin check-types` passes; `admin/src/components/ui/chart.tsx`
and `sidebar.tsx` exist; `git diff --stat` shows only new files plus `package.json`.

**Commit:** `feat(admin): add chart, sidebar, and supporting primitives`

## Task 2 — Desktop: create `components/ui` for the first time

**Files:** `desktop/src/renderer/components/ui/**`, `desktop/src/renderer/hooks/use-mobile.ts`,
`desktop/package.json`, `desktop/src/renderer/lib/utils.ts`

- Run from inside `desktop/` (`@/components/ui` → `src/renderer/components/ui`):
  ```bash
  cd desktop
  bunx shadcn@latest add button card input label select dialog alert-dialog badge \
    separator skeleton table tabs tooltip scroll-area chart sidebar sheet toggle-group
  ```
- Add the `cn` package to the desktop (`bun add cn@^0.5.0 --filter desktop`) so generated
  files resolve `import { cn } from "cn"` exactly like the admin's.
- Delete `desktop/src/renderer/lib/utils.ts` and update its importers to `cn`. Prove it with
  `grep -rn "lib/utils" desktop/src/renderer` returning nothing.
- **Do not** refactor any POS screen onto the primitives here — that is Phase 10. This task
  only creates the library and proves it compiles inside the Electron renderer.
- Keep the renderer's existing hand-written `Modal` for now; replacing it is Phase 10 work.

**Verify:** `bun run --filter desktop check-types` and `bun run --filter desktop test` pass
(339, none edited); `bun run --filter desktop start` boots without a CSP or module error.

**Commit:** `feat(desktop): add the shadcn primitive set`

## Task 3 — Chart layer proof (both apps)

**Files:** `admin/src/routes/_authenticated/dev-charts.tsx`,
`desktop/src/renderer/routes/_pos/dev-charts.tsx`,
`desktop/src/renderer/routes/_pos/app.tsx` (route dispatch),
`desktop/src/renderer/lib/router.ts` (route list, if enumerated)

- Build one throwaway **development-only** gallery per app that renders, with static fixture
  data and no API: a revenue area chart (two series), a tender-mix stacked bar, a top-products
  horizontal bar, and a sparkline KPI tile.
- Follow the shadcn contract exactly:
  `<ChartContainer config={…} className="min-h-[240px]">`, `var(--chart-1)` directly in the
  config colour, `ChartTooltip` + `ChartTooltipContent`, `CartesianGrid vertical={false}`,
  axes with `tickLine={false}` and `axisLine={false}`, and `role="img"` with a descriptive
  `aria-label` on the wrapper.
- Admin: guard the route so it 404s when `!import.meta.env.DEV`.
- Desktop: hash route `#dev/charts`, following the existing `dev-sync` / `dev-print`
  precedent.
- Both galleries carry a `TODO(phase-9)` / `TODO(phase-10)` comment: they are deleted when
  the real dashboard ships.

**Verify (visual, recorded as screenshots in `evidence/`):**
- Charts render at 320, 768, 1024, and 1440 px with no horizontal scroll and no zero-height
  container.
- Each chart's tooltip opens on hover **and** on keyboard focus (Tab into the chart).
- Recharts series take the brand ramp — an orange first series, not Recharts' default purple.
- Forcing `.dark` on `<html>` re-colours the charts through the tokens alone (no JS change).
- With `prefers-reduced-motion: reduce`, no entrance animation runs.

**Commit:** `feat(ui): prove the chart layer with a development gallery`

## Task 4 — Biome boundary rule, ready for Phase 8

**Files:** `admin/biome.json`, `desktop/biome.json`

- Add `linter.rules.style.noRestrictedImports` with a `patterns` entry that denies deep
  cross-module imports and names the barrel as the only entry point. Until `modules/` exists
  (Phase 8) the pattern simply matches nothing — it is introduced now so the rule is proven
  to load and fail correctly.

```json
{
  "linter": { "rules": { "style": { "noRestrictedImports": {
    "level": "error",
    "options": { "patterns": [
      { "group": ["#/modules/*/components/**", "#/modules/*/ui/**", "#/modules/*/hooks/**", "#/modules/*/api/**"],
        "message": "Import the module barrel (#/modules/<name>) instead of reaching into its internals." }
    ] }
  } } } }
}
```

- Prove it: add a temporary file importing `#/modules/x/components/y`, run `bun run lint`,
  confirm the error message, delete the file.

**Verify:** `bun run lint` is clean on the real tree; the probe fails with the intended
message; the probe file is gone (`git status` clean).

**Commit:** `chore(lint): prepare the module import-boundary rule`

## Definition of Done

- Both apps compile with the generated primitives; no primitive was hand-written.
- One `cn` implementation per app, resolved from the `cn` package.
- Chart gallery screenshots exist for light, dark, and reduced-motion at four widths.
- Desktop suite 339/339 unchanged.
