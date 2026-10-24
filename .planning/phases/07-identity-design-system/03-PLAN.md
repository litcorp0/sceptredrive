---
phase: 07-identity-design-system
plan: 03
wave: 2
title: packages/brand — tokens, fonts, chart ramp
requirements: [UIX-02, UIX-03]
depends_on: [01, 02]
status: planned
created: 2026-10-24
---

# Plan 03 — `packages/brand`: Tokens, Fonts, Chart Ramp

**Goal:** One workspace owns every brand value. Both clients delete their duplicated token
blocks and import the same file, so a colour change is one edit and drift is impossible.

## Task 1 — Create the workspace

**Files:** `packages/brand/package.json`, `packages/brand/tsconfig.json`,
`packages/brand/README.md`

```json
{
  "name": "@sceptre/brand",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": {
    "./tokens.css": "./src/tokens.css",
    "./fonts.css": "./src/fonts.css"
  },
  "dependencies": {
    "@fontsource-variable/inter": "5.3.0",
    "@fontsource-variable/jetbrains-mono": "5.3.0",
    "@fontsource-variable/space-grotesk": "5.3.0"
  }
}
```

- The package has **no build step**: it exports CSS source, exactly like `@sceptre/shared`
  exports TypeScript source.
- `README.md` states the one rule: *brand values live here and nowhere else.* Layout tokens
  (widths, z-index) may live in an app; colours, type, radii, and shadows may not.
- Run `bun install` so the workspace links.

**Verify:** `bun pm ls | grep @sceptre/brand` shows the workspace linked.

**Commit:** `feat(brand): add the shared brand workspace`

## Task 2 — `tokens.css`

**Files:** `packages/brand/src/tokens.css`

Write exactly this (values are the measured palette from CONTEXT D7; do not adjust):

```css
/*
 * Sceptre Drive brand tokens — the only place a brand colour is defined.
 * Consumed by admin/src/styles.css and desktop/src/renderer/index.css.
 *
 * Contrast (measured, WCAG 2.2 AA):
 *   ink #1B1F23 on brand #F26A1B ............ 5.41:1  primary buttons
 *   white on brand #F26A1B .................. 3.06:1  large text only — never body
 *   brand-ink #C25515 on white .............. 4.56:1  brand as text
 *   muted-ink #5C6470 on canvas ............. 5.53:1
 */

@custom-variant dark (&:is(.dark *));

:root {
  /* brand */
  --ink: #1b1f23;
  --brand: #f26a1b;
  --brand-fg: #1b1f23;      /* text ON brand */
  --brand-ink: #c25515;     /* brand AS text on light */
  --brand-tint: #fdeadd;
  --canvas: #f6f6f4;
  --surface: #ffffff;
  --muted-ink: #5c6470;
  --line: #e4e3df;

  /* chrome */
  --topbar: #1b1f23;
  --topbar-foreground: #f6f6f4;
  --topbar-muted: #a8b0b9;

  /* semantic */
  --ok: #1f7a4c;
  --warn: #b45309;
  --danger: #b42318;
  --info: #1f5fa8;

  /* shadcn surface mapping */
  --background: var(--canvas);
  --foreground: var(--ink);
  --card: var(--surface);
  --card-foreground: var(--ink);
  --popover: var(--surface);
  --popover-foreground: var(--ink);
  --primary: var(--brand);
  --primary-foreground: var(--brand-fg);
  --secondary: #ededea;
  --secondary-foreground: var(--ink);
  --muted: #ededea;
  --muted-foreground: var(--muted-ink);
  --accent: var(--brand-tint);
  --accent-foreground: var(--ink);
  --destructive: var(--danger);
  --destructive-foreground: #ffffff;
  --border: var(--line);
  --input: var(--line);
  --ring: var(--brand);

  /* chart ramp — ordered, distinguishable by lightness as well as hue */
  --chart-1: #f26a1b;
  --chart-2: #1b1f23;
  --chart-3: #8a939f;
  --chart-4: #c97b3d;
  --chart-5: #2f6f6a;

  /* shape */
  --radius: 0.625rem;
  --shadow-card: 0 1px 2px rgb(27 31 35 / 0.04), 0 1px 3px rgb(27 31 35 / 0.06);
  --shadow-pop: 0 10px 30px rgb(27 31 35 / 0.12);

  /* layout — prefixed to avoid colliding with the shadcn sidebar primitive's
     own --sidebar-width custom property */
  --layout-sidebar-width: 15.5rem;
  --layout-topbar-height: 3.25rem;
  --layout-content-max: 96rem;

  --sidebar: var(--surface);
  --sidebar-foreground: var(--ink);
  --sidebar-primary: var(--brand);
  --sidebar-primary-foreground: var(--brand-fg);
  --sidebar-accent: var(--brand-tint);
  --sidebar-accent-foreground: var(--ink);
  --sidebar-border: var(--line);
  --sidebar-ring: var(--brand);
}

.dark {
  --ink: #f6f6f4;
  --brand: #f26a1b;
  --brand-fg: #1b1f23;
  --brand-ink: #f5934f;     /* brand as text on dark: 5.9:1 on #22272C */
  --brand-tint: #3a2a1c;
  --canvas: #1b1f23;
  --surface: #22272c;
  --muted-ink: #a8b0b9;
  --line: #333a41;

  --topbar: #171b1f;
  --topbar-foreground: #f6f6f4;
  --topbar-muted: #a8b0b9;

  --ok: #4ade80;
  --warn: #fbbf24;
  --danger: #f97066;
  --info: #7cb8f5;

  --secondary: #2c343b;
  --muted: #2c343b;
  --accent: var(--brand-tint);
  --accent-foreground: var(--ink);
  --destructive: #b42318;
  --destructive-foreground: #ffffff;

  --chart-1: #f26a1b;
  --chart-2: #f6f6f4;
  --chart-3: #9aa3ae;
  --chart-4: #d98b4b;
  --chart-5: #4e9a94;

  --shadow-card: 0 1px 2px rgb(0 0 0 / 0.3);
  --shadow-pop: 0 10px 30px rgb(0 0 0 / 0.45);

  --sidebar: #171b1f;
  --sidebar-foreground: var(--ink);
  --sidebar-accent: #3a2a1c;
  --sidebar-accent-foreground: var(--ink);
  --sidebar-border: var(--line);
}

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-chart-1: var(--chart-1);
  --color-chart-2: var(--chart-2);
  --color-chart-3: var(--chart-3);
  --color-chart-4: var(--chart-4);
  --color-chart-5: var(--chart-5);
  --color-ink: var(--ink);
  --color-brand: var(--brand);
  --color-brand-fg: var(--brand-fg);
  --color-brand-ink: var(--brand-ink);
  --color-brand-tint: var(--brand-tint);
  --color-canvas: var(--canvas);
  --color-surface: var(--surface);
  --color-muted-ink: var(--muted-ink);
  --color-line: var(--line);
  --color-topbar: var(--topbar);
  --color-topbar-foreground: var(--topbar-foreground);
  --color-topbar-muted: var(--topbar-muted);
  --color-ok: var(--ok);
  --color-warn: var(--warn);
  --color-danger: var(--danger);
  --color-info: var(--info);
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-sidebar: var(--sidebar);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-ring: var(--sidebar-ring);
}
```

Notes for the executor:
- Chart tokens are **hex, not `oklch()`**, so the shadcn chart wrapper can pass
  `var(--chart-1)` straight into SVG `fill`/`stroke`.
- `--brand-ink` exists because raw `--brand` as text fails AA on light surfaces.
- Do not add a `--font-sans` here; typography is Task 3.

**Verify:** the file parses — after Task 4 both apps build; a deliberate typo in the file
fails both builds (confirm locally, then revert).

**Commit:** `feat(brand): define the Sceptre Drive token system`

## Task 3 — `fonts.css`

**Files:** `packages/brand/src/fonts.css`

```css
/* Self-hosted: the desktop CSP is font-src 'self', so no CDN font can ever load. */
@import "@fontsource-variable/inter/wght.css";
@import "@fontsource-variable/space-grotesk/wght.css";
@import "@fontsource-variable/jetbrains-mono/wght.css";

@theme inline {
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
  --font-display: "Space Grotesk Variable", "Inter Variable", ui-sans-serif, sans-serif;
  --font-mono: "JetBrains Mono Variable", ui-monospace, SFMono-Regular, monospace;
}

@layer base {
  body {
    font-family: var(--font-sans);
    font-feature-settings: "cv11" 1; /* Inter: single-storey a is off; keeps counters legible */
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  h1, h2, h3, .font-display {
    font-family: var(--font-display);
    letter-spacing: -0.015em;
  }

  /* Every amount, quantity, receipt number, and timestamp. */
  .tabular, table, [data-money] {
    font-variant-numeric: tabular-nums;
  }

  code, kbd, samp, pre, .font-mono {
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
  }
}
```

- Confirm the exact fontsource entry files exist in the installed packages
  (`wght.css` for variable weight-only builds). If a package ships `index.css` instead, use
  that filename — check `node_modules/@fontsource-variable/<family>/` before writing.
- `font-display: swap` is already set by fontsource.

**Verify:** in both apps, a paragraph renders in Inter, an `h1` in Space Grotesk, and a
`font-mono` span in JetBrains Mono; the Network panel shows same-origin woff2 files and
**no** request to `fonts.googleapis.com` / `fonts.gstatic.com`.

**Commit:** `feat(brand): self-host Space Grotesk, Inter, and JetBrains Mono`

## Task 4 — Consume the tokens in both apps

**Files:** `admin/src/styles.css`, `desktop/src/renderer/index.css`

- Delete every custom-property block, the `.dark` block, and the `@theme inline` block from
  both files (they are currently identical copies).
- Leave at the top of each file, in this order:

```css
@import "tailwindcss";
@import "@sceptre/brand/tokens.css";
@import "@sceptre/brand/fonts.css";
@import "tw-animate-css";
```

- Keep the app-specific `@layer base` reset (`* { @apply border-border outline-ring/50 }`),
  the `body` background/foreground rule, and the print rules in the admin. Remove the
  duplicated `font-sans` declaration — `fonts.css` owns it.
- Add `"@sceptre/brand": "workspace:*"` to `dependencies` in `admin/package.json` and
  `devDependencies` in `desktop/package.json` (the desktop's renderer-only packages live
  there so Vite bundles them and Forge does not treat them as runtime externals).
- Replace the admin's `GA` monogram and the desktop's name strings with `SD` + `Sceptre Drive`
  in the brand components touched by this plan (`SidebarBrand`, `AppHeader`).

**Verify:** `bun run --filter admin build` succeeds and the emitted CSS contains exactly one
definition of `--brand`; `bun run --filter desktop start` renders with the new palette and a
charcoal topbar; `grep -rn '#f26a1b\|#1b1f23' admin/src desktop/src/renderer` returns **no**
matches (all values come from the package).

**Commit:** `refactor(ui): consume the shared brand tokens in both clients`

## Definition of Done

- `packages/brand` exists, is linked, and is the only source of brand values.
- Both apps build; both render the new palette in light and dark.
- No font request leaves the machine.
- `grep` for the two brand hexes outside `packages/brand` finds nothing.
