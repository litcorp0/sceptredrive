---
phase: 16-web-presence
plan: 01
title: Brand assets — the supplied mark, three variants, three apps
lane: shared
depends_on: []
requirements: [WEB-01]
---

# Plan 01 — One mark, three variants, three apps

## Goal

The supplied artwork becomes a transparent, reproducible brand asset set in
`packages/brand/assets`, and each of the three apps shows the right variant on the right
surface. No app invents a logo, and the master has one owner.

## Read first

- `00-DECISIONS.md` P16-D11, D12, D13.
- `01-RESEARCH.md` §2.5 (logo placement) and §3 (extraction facts).
- `packages/brand/README.md` — the package's "one source" rule.
- `admin/src/components/layout/sidebar.tsx:351-367`,
  `admin/src/modules/auth/components/auth-shell.tsx:17-32`.
- `desktop/src/renderer/components/layout/app-header.tsx:47-75`,
  `desktop/src/renderer/modules/auth/pages/login-page.tsx:185-200`, `:600-700`.

## Tasks

### 1. Master assets

Create `packages/brand/assets/` and produce, with ImageMagick 7:

- `logo-source.jpg` — the supplied original, renamed (no spaces), kept as provenance.
- `logo.png` — corner flood fill (`-fuzz 9%`, all four corners), `-trim +repage`, transparent.
  1159×504 expected.
- `logo-inverse.png` — `logo.png` with the wordmark sampled at `#1B1F23` recoloured to
  `#F6F6F4` (`-fuzz 12% -fill '#F6F6F4' -opaque '#1b1f23'`).
- `logo-icon.png` — the lockup fitted into a 512×512 transparent square with 8 % padding.

Record the exact commands in `packages/brand/assets/README.md`. Do not commit the original
WhatsApp filename from `admin/public/`.

### 2. Distribution

`scripts/sync-brand-assets.mjs` copies `logo.png`, `logo-inverse.png`, `logo-icon.png` into
`admin/public/`, `desktop/public/`, `web/public/`. Root script `brand:assets` runs it. The
copies are committed so a fresh clone and a packaged build both have them.

### 3. Admin

- `sidebar.tsx`: the expanded header shows `<img src="/logo.png" alt="Sceptre Drive"
  className="h-8 w-auto" />` plus the "Admin console" caption; the collapsed rail keeps the
  `SD` tile.
- `auth-shell.tsx`: the lockup replaces the `SD` tile and duplicate wordmark.
- `__root.tsx` `head().links`: add `rel="icon"` → `/logo-icon.png` and
  `rel="apple-touch-icon"` → `/logo-icon.png`.
- Images are `draggable={false}`, `decoding="async"`, and never the only accessible label.

### 4. Desktop

- `app-header.tsx`: replace the "Sceptre Drive" eyebrow text with the inverse lockup
  (`h-7 w-auto`), keeping the branch label and terminal code beneath/beside it.
- `login-page.tsx`: inverse lockup at the top of the dark aside; the original lockup above
  the light form's eyebrow in the enrolment and credential screens.
- No CSP change: the files are same-origin under `app://`.

## Verification

- `identify` reports 1159×504 with an alpha channel for `logo.png`; the inverse and icon
  have alpha too; no file is larger than 200 KB.
- Render `logo.png` on `#F6F6F4` and `logo-inverse.png` on `#1B1F23`; screenshot both at
  2× and confirm the wordmark is readable and no background rectangle is visible.
- Admin `/login`, the authenticated shell and the POS header/login are opened in a browser;
  no broken image and no layout shift.
- `bun run brand:check` still passes; `bun run tokens:check` still passes.

## Write set

`packages/brand/assets/**`, `packages/brand/README.md`, `scripts/sync-brand-assets.mjs`,
root `package.json` (the script), `admin/public/logo*.png`, `admin/src/components/layout/sidebar.tsx`,
`admin/src/modules/auth/components/auth-shell.tsx`, `admin/src/routes/__root.tsx`,
`desktop/public/logo*.png`, `desktop/src/renderer/components/layout/app-header.tsx`,
`desktop/src/renderer/modules/auth/pages/login-page.tsx`, `web/public/logo*.png`.
