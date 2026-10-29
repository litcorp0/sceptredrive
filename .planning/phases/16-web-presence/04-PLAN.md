---
phase: 16-web-presence
plan: 04
title: The web workspace and the Sceptre Drive site
lane: web
depends_on: [01, 02, 03]
requirements: [WEB-07, WEB-08, WEB-11, WEB-12]
---

# Plan 04 — The web workspace and the Sceptre Drive site

## Goal

A visitor can understand the business, find a part family, see the branches and contact the
counter in one fast, accessible site — built from the console-managed content with a
fallback that never fails. The store seam exists as `/shop`, not as a fake cart.

## Read first

- `00-DECISIONS.md` P16-D1, D2, D9, D14–D16, D18, D19, D21.
- `01-RESEARCH.md` §2.6–§2.7.
- `admin/vite.config.ts` (the dedupe/alias/env pattern to mirror).
- `admin/src/routes/__root.tsx` (the shell/head pattern).
- `packages/brand/src/tokens.css` and `fonts.css`.
- `web/` as scaffolded by the operator (keep the good parts, replace the demo).

## Tasks

### 1. Adopt the workspace

- Add `"web"` to `workspaces.packages` in the root `package.json`.
- Delete `web/bun.lock`; run the root `bun install` so one lockfile owns the tree.
- `web/package.json`: scripts `dev` (`vite dev --port 5173`), `build`, `preview`,
  `check-types` (`tsc --noEmit`), `lint` (`biome check src`), `test` (`vitest run`),
  `generate-routes` (`tsr generate`); dependencies pinned to the admin versions and the
  catalog for react/react-dom/zod; `@sceptre/brand` and `@sceptre/shared` as workspace deps.
  Remove the scaffold add-ons the site does not use (`@faker-js/faker`,
  `@tanstack/react-form`, `@tanstack/react-table`, `@tanstack/match-sorter-utils`) and their
  pristine components.
- `web/tsconfig.json` extends `../tsconfig.base.json`, adds DOM libs, the `#/*` and `@/*`
  paths and `types: ["vite/client"]`.
- `web/vite.config.ts`: `envDir: '..'`, `dedupe: ['react', 'react-dom']`, the
  `@sceptre/shared` source alias, the same plugin order as admin.
- `web/biome.json`: `root: false`, `extends: '//'`, double quotes, the same ignore list as
  admin. Remove `!web` from the root `biome.json`.
- `scripts/check-tokens.mjs`: add `web` to `APPS`, `APP_STYLESHEETS`
  (`web/src/styles.css`) and `APP_SOURCE_DIRS` (`web/src/`).

### 2. Content layer

- `web/src/lib/site-schema.ts`: a Zod schema mirroring `SiteContent` (shared type) with
  permissive optional strings; a parse failure returns `null`.
- `web/src/lib/site-fallback.ts`: the complete default content — "Sceptre Drive",
  "Parts that keep Ghana moving", hero/about copy, `COMING_SOON`, empty contact fields,
  and the two seeded branches with `TODO` hours/phone marked in one obvious place.
- `web/src/lib/site-content.ts`: a `createServerFn({ method: 'GET' })` that fetches
  `${WEB_API_URL}/api/public/site` with a 2 s timeout, parses, caches for 5 s in dev and
  60 s in production, and returns `fallback` on any failure. `WEB_API_URL` comes from
  `process.env` (server only), default `http://localhost:4000`.
- Root route `beforeLoad` returns `{ site }`; child routes read it from the route context.
  No browser fetch, no CORS, no API URL in the client bundle.
- `web/src/lib/parts.ts`: six part families with a code, summary, examples and a `slug`,
  plus a `filterParts(query)` helper — presentation copy only, never inventory.
- `web/src/lib/contact.ts`: `telHref`, `waHref`, `mailHref`, `mapsHref`; empty input returns
  `null` so the UI can hide the action.

### 3. Design

- `web/src/styles.css` imports Tailwind, `@sceptre/brand/tokens.css`,
  `@sceptre/brand/fonts.css` and `tw-animate-css`; site-only tokens are derived from the
  brand tokens (no hex literals): ticket paper, perforation, section rhythm, type scale.
- The direction is "The Counter Ticket": charcoal `--ink`, paper `--canvas`, one `--brand`
  accent, Space Grotesk display, Inter body, JetBrains Mono for codes and labels.
- Signature elements: the hero's till-ticket card with a CSS perforated edge; a hairline
  parts index whose rows reveal a ticket preview; a single orchestrated load (the orange
  speed line draws once, the ticket prints down) with a 40 ms stagger.
- Every animation is wrapped by `prefers-reduced-motion: reduce`; no counters, no parallax,
  no gradient washes.

### 4. Shell and routes

- `__root.tsx`: `<html lang="en">`, skip link, `SiteHeader`, `<main id="main">`, `SiteFooter`,
  the devtools only in DEV, the shared `head` defaults, `notFoundComponent`.
- `/` — hero + ticket, category index, "how the counter works" (three real steps), why
  Sceptre Drive, branch band, closing CTA.
- `/parts` — searchable family index (`?q=` validated) with an "Ask about this part"
  WhatsApp/tel action when configured, otherwise "Visit a branch".
- `/services` — workshop supply, fleet/trade accounts, sourcing; no invented SLAs.
- `/branches` — branch cards from the endpoint/fallback with address, phone, hours, map;
  warehouses excluded by the API already.
- `/about` — the business story and standards; the copy comes from `web.aboutBody`.
- `/contact` — the actions that exist (phone, WhatsApp, email, visit), no fake form.
- `/shop` — the teaser driven by `web.shopStatus`; explicitly "opening soon" with the
  counter contact; the future store's seam.
- `sitemap[.]xml.ts` and `robots[.]txt.ts` server routes built from `VITE_SITE_URL`.
- Images: 4–6 licensed photos in `web/public/photos/`, `width`/`height` declared, lazy
  below the fold, `object-cover`, one hero image preloaded, `CREDITS.md` recording each.

### 5. SEO and accessibility

- Per-route `head`: title, description, `og:title`, `og:description`, `og:image`, canonical.
- JSON-LD `AutoPartsStore` + `LocalBusiness` with the branches as `department`, the contact
  fields, the social links; serialized with `<` escaped.
- One `h1` per page, landmarks, labelled controls, 44 px targets, visible focus,
  no colour-only state, skip link, `lang`, descriptive alt text.
- An OG image (`web/public/og.png`) composed from the logo and the paper/ink tokens.

### 6. Tests

`web/src/lib/*.test.ts` (vitest, node):
- the fallback parses as `SiteContent`;
- a malformed API payload falls back;
- `filterParts` is case/diacritic tolerant and empty-query returns all;
- `waHref`/`telHref`/`mailHref` return `null` for empty and a correct URL otherwise;
- `sitemap` includes every route.

## Verification

- `bun run --filter web check-types`, `lint`, `test`, `build` green.
- Dev server on 5173 renders every route with no console error, at 375/768/1024/1440.
- With the API stopped, every route still renders the fallback (no error boundary).
- An edit to `web.heroHeading` in the console appears on the home page within 5 s in dev.
- Keyboard-only: skip link, header, parts filter, branch actions; focus visible throughout.
- `prefers-reduced-motion: reduce` stops the load sequence; the page is complete without it.
- Lighthouse-style checks: no layout shift from images, one `h1`, meta present, JSON-LD
  parses.

## Write set

`web/**` (except the scaffold's `bun.lock`), root `package.json`, `biome.json`,
`scripts/check-tokens.mjs`, `.env.example`, `scripts/sync-brand-assets.mjs` (asset copy),
`.gitignore` only if a new artefact needs it.
