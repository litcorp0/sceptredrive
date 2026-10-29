# Phase 16 — Decisions

**Date:** 2026-10-29
**Status:** locked for planning
**Supersedes:** `00-CONTEXT.md` where the two disagree.

Twenty-two decisions. The three operator answers of 2026-10-29 are D1 (workspace), D3
(Settings group) and D8 (text/links only); the rest are engineering decisions inside that
frame.

---

## A. Scope and boundaries

| # | Decision | Choice |
|---|---|---|
| P16-D1 | Workspace | `web/` joins the Bun workspace in this repository. The scaffold the operator created with `npx @tanstack/cli create web` is adopted, not regenerated; its own `bun.lock` and `node_modules` are removed and the root lockfile owns every version. |
| P16-D2 | Framework pinning | `web` uses the exact React/TanStack versions the admin console uses (`react`/`react-dom` catalog; `@tanstack/react-router` 1.170.45; `react-query` 5.104.4; `react-start` 1.169.3). The scaffold's +1 patch versions are lowered so one copy of each package resolves. |
| P16-D3 | Admin surface | Content is edited in **Settings → Website**, generated from the API registry. No dedicated console page, no new permission: `settings.read` / `settings.update` already gate it. |
| P16-D4 | Content registry | A `web.*` namespace in `SETTING_DEFINITIONS` with a Zod schema and a default per key. The site is valid before the first edit; an operator override is audited by the existing `setting.updated` writer. |
| P16-D5 | Branch data | `branch.address` and `branch.phone` remain the only source for address and phone. `web.branchHours` and `web.branchMapUrl` are branch-scoped, admin-only settings. Managers keep editing address/phone on the existing branch form, not the website group. |
| P16-D6 | Public endpoint | `GET /api/public/site` in a new read-only module `api/src/modules/site/`. It composes the settings service and the branch service; it owns no table and no migration. |
| P16-D7 | Public payload | A fixed, typed projection: `site` (identity, copy, contact, social, shop status, `updatedAt`) and `branches` (active `RETAIL` only). The key names and the raw settings never leave the server. |
| P16-D8 | Configurable fields | `web.siteName`, `web.tagline`, `web.heroHeading`, `web.heroBody`, `web.aboutBody`, `web.announcement`, `web.shopStatus`, `web.contactEmail`, `web.contactPhone`, `web.whatsapp`, `web.instagram`, `web.facebook`, `web.tiktok`; branch-scoped `web.branchHours`, `web.branchMapUrl`. |
| P16-D9 | Commerce boundary | `/shop` is a teaser controlled by `web.shopStatus`. No product prices, stock, cart, checkout, accounts or Paystack on the site. The typed parts index is presentation copy, not inventory. |
| P16-D10 | Photos | Licensed stock, downloaded locally into `web/public/photos/`, credited in `web/CREDITS.md`, dimensions declared, AVIF/WebP where the build produces it. Console uploads are explicitly out of scope. |

## B. Design and brand

| # | Decision | Choice |
|---|---|---|
| P16-D11 | Logo master | `packages/brand/assets/logo.png` (transparent, black wordmark), `logo-inverse.png` (off-white wordmark), `logo-icon.png` (padded square for favicons), `logo-source.jpg` (the supplied original). |
| P16-D12 | Asset distribution | `scripts/sync-brand-assets.mjs` copies the master set into `admin/public`, `desktop/public` and `web/public`. The three apps import `@sceptre/brand` for tokens but reference `/logo*.png` for the assets, so a favicon can be a real URL. |
| P16-D13 | Dark surfaces | The POS fascia and the POS login aside use `logo-inverse.png`. The admin sidebar is white and uses `logo.png`. The collapsed admin rail keeps the documented `SD` monogram because a 2.3:1 lockup is illegible at 32 px. |
| P16-D14 | Website direction | "The Counter Ticket": charcoal `--ink`, paper `--canvas`, one `--brand` accent, Space Grotesk display, Inter body, JetBrains Mono for part codes. A ticket artifact is the signature; one orchestrated load moment; everything else quiet. |
| P16-D15 | Website chrome | Header with the logo, four links and a "Find a part" CTA; footer with the inverse logo, contact, branch links and the legal line. No carousel, no video, no newsletter form (there is no backend to receive it). |
| P16-D16 | Copy | Plain, specific, Ghanaian. "Parts that keep Ghana moving." No invented counts, no "authorised distributor" claim, no third-party brand logos. |

## C. Engineering

| # | Decision | Choice |
|---|---|---|
| P16-D17 | Shared contract | `packages/shared/src/site.ts` owns `SiteContent`, `SiteBranch`, `SHOP_STATUSES` and the label map. The API mapper and the web loader both import it; neither invents a field. |
| P16-D18 | Cache | `Cache-Control: public, max-age=60, stale-while-revalidate=300`. The web loader caches for 5 s in dev and 60 s in production, keyed by process. The dev short cache is so an operator sees an edit immediately. |
| P16-D19 | Fallback | `web/src/lib/site-fallback.ts` is a complete, typed default. A missing API, a 5xx, a slow response (2 s timeout) or an invalid payload all resolve to the fallback, and the page renders. |
| P16-D20 | Admin control | `SettingControl` gains `textarea` for `web.heroBody` and `web.aboutBody`; every other field uses the existing text/select/boolean controls. `controlFor` stays total. |
| P16-D21 | Gates | `web` is added to `scripts/check-tokens.mjs` (`APPS`, `APP_STYLESHEETS`, `APP_SOURCE_DIRS`); the root `biome.json` `!web` exclusion is removed and `web/biome.json` extends the root config; `web` gains `check-types`, `lint`, `test` (vitest) and `build` scripts. |
| P16-D22 | Verification | The phase is complete only when: the logo renders in all three apps on light and charcoal; a settings edit reaches the site within the cache window; the endpoint leaks nothing and excludes inactive/warehouse branches; the site renders from the fallback with the API stopped; keyboard/contrast/reduced-motion legs pass; `lint`, `check-types`, `test`, `build`, `brand:check`, `tokens:check` are green. |
