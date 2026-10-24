---
phase: 07-identity-design-system
plan: 06
wave: 3
title: Shell chrome on the new design system
requirements: [UIX-02, UIX-04]
depends_on: [03, 04, 05]
status: planned
created: 2026-10-24
---

# Plan 06 — Shell Chrome on the New Design System

**Goal:** Both clients open onto chrome that belongs to Sceptre Drive — a charcoal fascia in
the admin, a calm counter header in the POS — built from the shared tokens and generated
primitives, with no behaviour change to any screen underneath.

**Scope guard:** this plan changes **shell, header, navigation, page header, and shared
state components only**. It does not move pages (Phase 8), does not touch POS cart or sale
logic (Phase 10), and does not add analytics navigation (Phase 9).

## Task 1 — Admin sidebar as a real primitive

**Files:** `admin/src/components/layout/sidebar.tsx` (rewrite),
`admin/src/components/layout/app-shell.tsx` (rewrite),
`admin/src/components/layout/user-menu.tsx`,
`admin/src/components/layout/branch-switcher.tsx`

- Replace the hand-rolled `<aside>` + `p-2` link list with the shadcn `SidebarProvider` /
  `Sidebar` / `SidebarContent` / `SidebarGroup` / `SidebarMenu` / `SidebarMenuButton`
  primitives. `collapsible="icon"` on desktop, `Sheet` on mobile — one layout, two
  experiences.
- Group the existing items (no new routes are added in this phase):

  | Group | Items |
  |---|---|
  | Overview | Dashboard |
  | Operations | Catalog · Inventory · Suppliers · Customers · Loyalty |
  | Organisation | Branches · Terminals · Staff |
  | System | Audit log · Settings |

  Keep the `permission` filter exactly as it is — a cashier sees nothing, a manager sees
  their permitted set, an admin sees everything. The grouping changes presentation only.
- Active state: `bg-sidebar-accent text-sidebar-accent-foreground` plus a 2 px
  `--brand` left rail drawn with a pseudo-element. That rail is the only orange in the
  sidebar — do not also colour the label.
- Brand block: `SD` monogram in `font-display`, `Sceptre Drive` wordmark, `Admin console`
  caption. Sidebar footer shows the signed-in role and the build version.
- Override the primitive's width from the shared token (`--layout-sidebar-width`) in the
  provider's inline style or a `[data-sidebar]` rule — never a second hard-coded width.
- Keep `aria-label="Main"`, add `aria-current="page"` via the router's `activeProps`, and
  keep keyboard focus visible.

**Verify:** every existing route is still reachable and permission-filtered; the sidebar
collapses to icons at `lg` and opens as a sheet below it; tab order traverses the nav before
the main region; no route file changed.

**Commit:** `feat(admin): rebuild the sidebar on the shadcn primitive`

## Task 2 — Charcoal fascia topbar

**Files:** `admin/src/components/layout/app-shell.tsx`,
`admin/src/components/layout/branch-switcher.tsx`,
`admin/src/components/layout/user-menu.tsx`, `admin/src/routes/__root.tsx`

- The topbar is `bg-topbar text-topbar-foreground` at `--layout-topbar-height`, sticky,
  `z-30`. This charcoal band against the paper canvas is the identity decision — do not
  soften it with a gradient.
- Contents, left to right: mobile menu trigger · breadcrumb (section › page) · spacer ·
  branch switcher · user menu. Muted text on the fascia uses `--topbar-muted` (7.89:1 on the
  fascia ink).
- Branch switcher keeps its current behaviour: managers see a locked badge with their branch
  code, admins get the popover list. It uses `text-topbar-foreground` so it reads on the
  fascia.
- Add a **theme toggle** (light / dark / system) stored in `localStorage` under
  `sceptre:theme`, applied by a pre-hydration inline script in `__root.tsx` so there is no
  light flash. Respect `prefers-color-scheme` for `system`.
- Add a skip link as the first focusable element: `Skip to main content` → `#main`. Give
  `<main id="main" tabIndex={-1}>`.
- Keep `print:hidden` on both chrome regions.

**Verify:** keyboard-only pass — Tab from the address bar reaches the skip link first, then
the nav; the theme toggle persists across reload with no flash; print preview of a statement
shows no chrome.

**Commit:** `feat(admin): charcoal topbar, branch context, and theme switching`

## Task 3 — Shared page and state components

**Files:** `admin/src/components/common/page-header.tsx`,
`admin/src/components/common/status-badge.tsx`,
`admin/src/components/common/table-message.tsx`,
`admin/src/components/common/pagination.tsx`,
`admin/src/components/common/empty-state.tsx` (new)

- `PageHeader`: Space Grotesk title (`text-2xl`, `-0.015em`), muted description, an actions
  slot, and an optional `eyebrow` for the breadcrumb root. Keep the existing props so no
  caller changes are required.
- `StatusBadge`: map every existing status string to the semantic tokens — `ok`, `warn`,
  `danger`, `info`, `muted` — with a dot plus a text label (never colour alone). Keep the
  current `variant` API and add the new variants additively.
- `EmptyState` (new): icon, one-sentence explanation of what is missing, and one primary
  action. Used by any list that is currently rendering a bare "No results" paragraph —
  files touched incidentally get the swap, the rest move in Phase 8.
- `TableMessage`: loading / error / empty variants get `Skeleton` rows instead of a bare
  paragraph, so a slow query does not shift the layout.
- All money and count cells inside these components use `font-mono` with `tabular-nums`.

**Verify:** creeping drift check — `grep -rn 'rounded-lg border' admin/src/components/common`
returns nothing (the card border now comes from `Card`), and `bun run --filter admin build`
passes; visual pass over dashboard, staff, and customers lists.

**Commit:** `feat(admin): redesign shared page and state components`

## Task 4 — Desktop chrome

**Files:** `desktop/src/renderer/components/pos/app-header.tsx`,
`desktop/src/renderer/components/pos/sync-badge.tsx`,
`desktop/src/renderer/components/pos/product-grid.tsx` (tokens only),
`desktop/src/renderer/components/pos/cart-totals.tsx` (tokens only),
`desktop/src/renderer/routes/_pos/app.tsx` (centered/boot screens)

- Header becomes `bg-topbar text-topbar-foreground`, same fascia concept at counter scale:
  branch · terminal on the left, sync badge and unprinted count in the middle, cashier and
  the two actions on the right. Height `--layout-topbar-height`, targets ≥ 44 px.
- `SyncBadge`: online/offline/pending get semantic tokens (`ok` / `warn` / `danger`) plus an
  icon and a word — never colour alone. Offline keeps the exact non-blocking behaviour and
  copy; this is a visual change to a state machine that must not move.
- Boot/centered screens use the brand monogram and Space Grotesk, and the copy is honest
  ("Opening the terminal…", "Encrypted local database") — unchanged text, new type.
- Cart totals: the grand total uses `font-display` + `tabular-nums`; the pay button is
  `bg-primary text-primary-foreground` (charcoal on orange), full width, 56 px tall.
- Do not restructure the three-column sell layout, the product grid density, or any keyboard
  shortcut. That is Phase 10.

**Verify:** `bun run --filter desktop test` 339/339; manual launch shows the new fascia and
the badge still turns amber/green at the right moments; the offline copy is unchanged
byte-for-byte; all interactive targets measure ≥ 44×44 px in devtools.

**Commit:** `feat(desktop): redesign the POS header and totals chrome`

## Task 5 — Motion and focus defaults

**Files:** `packages/brand/src/tokens.css` (append), `admin/src/styles.css`,
`desktop/src/renderer/index.css`

- Add to the brand file:
  ```css
  @layer base {
    :focus-visible {
      outline: 2px solid var(--brand);
      outline-offset: 2px;
      border-radius: var(--radius-sm);
    }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
      }
    }
  }
  ```
- Transitions are limited to `color`, `background-color`, `border-color`, `box-shadow`, and
  `transform`, at 150–200 ms. No animated `width`/`height` anywhere — the sidebar collapse
  uses the primitive's transform.
- No animation library is added.

**Verify:** with reduced motion forced in devtools, sidebar and dialogs appear instantly;
keyboard focus shows a visible orange ring on every interactive element in both apps.

**Commit:** `feat(brand): add focus and reduced-motion defaults`

## Definition of Done

- No route file changed; no business logic touched.
- Admin and desktop chrome read as one product.
- Admin build passes, desktop suite 339/339, packaged shell smoke 38/38.
- Screenshots of light and dark admin shell + POS header saved to `evidence/`.
