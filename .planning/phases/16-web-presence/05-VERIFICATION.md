# Phase 16 — Verification

**Date:** 2026-10-29
**Status:** complete and verified — 4/4 plans.
**Baseline:** shared **348**, API **841**, desktop **615**, admin modules **21/21**, POS **16/16**.
**Now:** shared **354**, API **850**, desktop **616**, web **26** (new), admin modules **21/21**, POS **16/16**.

This document maps every roadmap criterion and every WEB requirement to a committed
test, a command, or an observed browser leg. Where something is not proven, §7 says so
instead of implying otherwise.

---

## 1. Goal-backward: the eight roadmap criteria

| # | Criterion | Evidence |
|---|---|---|
| 1 | The supplied logo appears correctly in the console, the POS and the site — inverse on charcoal, usable favicon | `logo.png`/`logo-inverse.png`/`logo-icon.png` are 1159×504 / 1159×504 / 512×512 RGBA; the admin sidebar and login render the lockup (screenshots), the site header/footer render it, and the POS header/login reference `/logo-inverse.png` and `/logo.png` from `desktop/public` (packaged build green). The favicon is linked in the admin and the site root. |
| 2 | An administrator edits identity, hero, about, contact, social, shop status and per-branch hours/map in Settings → Website; changes are audited and appear without a rebuild | Admin `SettingRow` renders 2 textareas and the group; a Playwright leg edited `web.heroHeading` through the page and `GET /api/public/site` returned the new value immediately; `platform.test.ts` proves the `setting.updated` audit path; `site.test.ts` proves the branch override. |
| 3 | `GET /api/public/site` is whitelisted, excludes inactive/warehouse branches, is rate-limited and cached | `site.test.ts` 8 tests: defaults, branch list, edit, override, forbidden-key sweep, cache header, 429 on the 121st request, no POST. |
| 4 | The site renders every route from the endpoint and falls back when the API is unavailable | `web/test/walkthrough.mjs` 38 PASS / 0 FAIL; `site-content.test.ts` covers non-2xx, malformed, network error and trailing-slash; the fallback is complete typed content. |
| 5 | WCAG 2.2 AA: keyboard, contrast, focus, 44 px targets, reduced motion, one h1 per page | Walkthrough asserts one `h1` per route and no console errors; tab order was checked (skip link → logo → nav → CTA); reduced-motion emulation returned `animation: none` and full opacity; small text was moved off `brand-ink` on canvas (4.22:1) to `ink` (15.32:1) or ink with an orange underline. |
| 6 | SEO: per-route metadata, `AutoPartsStore` JSON-LD, sitemap, robots, social image | Walkthrough parses the JSON-LD (`AutoPartsStore`, name, departments), checks `sitemap.xml` lists every route and `robots.txt` points at it; `og.png` 1200×630 is referenced absolutely via `VITE_SITE_URL`. |
| 7 | `/shop` is an honest coming-soon seam; no cart, checkout, price, stock or account surface | The page states the shop is coming and that no online payment exists; the walkthrough asserts zero controls named add-to-cart/buy/checkout/pay on every route. `filterParts` is presentation copy, not inventory. |
| 8 | Every gate green and `tokens:check` covers `web` | §3. |

## 2. Requirements

| Requirement | Evidence |
|---|---|
| WEB-01 | `packages/brand/assets/**`, `scripts/sync-brand-assets.mjs`, committed copies in all three `public/` dirs; `brand:assets` idempotent |
| WEB-02 | `packages/shared/src/site.ts` + `site.test.ts` (6 tests) |
| WEB-03 | `web.*` definitions in `settings.validation.ts`; `site.test.ts` resolves defaults and overrides |
| WEB-04 | `admin/src/modules/settings` Website group + textarea; settings page leg and 2 textareas observed |
| WEB-05 | `api/src/modules/site/**`; `site.test.ts` |
| WEB-06 | `listActiveRetailBranchContacts` filters `RETAIL` + active; `site.test.ts` asserts warehouse/inactive absence |
| WEB-07 | `web/package.json`, `web/tsconfig.json`, `web/vite.config.ts`, `web/biome.json`; one React/TanStack version in the lockfile |
| WEB-08 | Seven routes + 404; `web/test/walkthrough.mjs` |
| WEB-09 | `readSiteContent` + `site-content.test.ts` + fallback; walkthrough passes with the API running and the fallback is the failure path |
| WEB-10 | Admin edit round-trip observed; `setting.updated` is the existing audited writer |
| WEB-11 | `json-ld.ts`, root `head`, `sitemap[.]xml.ts`, `robots[.]txt.ts`, `og.png`; walkthrough |
| WEB-12 | `web/src/styles.css` reduced-motion block; walkthrough + emulation; photos in AVIF/WebP with dimensions |

## 3. Gates

| Gate | Result |
|---|---|
| `bun run check-types` | 7/7 workspaces exit 0 |
| `bun run lint` | exit 0, 26 pre-existing warnings (evidence scripts and admin suppressions), no errors |
| `bun run test` | shared **354**, API **850**, desktop **616**, web **26** — all pass |
| `bun run build` | admin, desktop (Electron package) and web all exit 0 |
| `bun run brand:check` | OK over **1 269** tracked files |
| `bun run tokens:check` | OK, including `web/src` and `web/src/styles.css` |
| `bun run --filter web test:walkthrough` | 38 PASS / 0 FAIL |

## 4. The endpoint, observed

```text
GET /api/public/site → 200
cache-control: public, max-age=60, stale-while-revalidate=300
{"content":{"site":{...},"branches":[...],"updatedAt":"..."}}
```

The live development database returned one active retail branch (TEM-MNZ) and no
warehouse. The payload carries no `key`, `source`, `writableBy`, `branchScoped`, `id`,
`isActive` or `type`; a recursive test asserts it.

## 5. The console round-trip, observed

1. Signed in as the seeded admin, opened `/settings`, searched "hero".
2. The **Website** group rendered `web.heroHeading` (text) and `web.heroBody`
   (textarea, 28 rem).
3. Changed the headline and saved; the toast read "Setting saved" and the source badge
   changed from Default to Global.
4. `GET /api/public/site` immediately returned the new headline.
5. The test row was then removed from the development database so the default headline
   applies again; the audit entry remains, which is correct (an audit is append-only).

## 6. Accessibility and behaviour legs

- **One `h1` per route**, asserted by the walkthrough after every page.
- **Tab order**: skip link → logo link → five nav links → "Find a part". Focus is visible
  through the brand's `:focus-visible` outline.
- **Reduced motion**: with `prefers-reduced-motion: reduce`, the ticket's `animation-name`
  is `none`, the hero is fully opaque, and the CSS media query also disables the draw and
  the row transitions.
- **Contrast**: `ink` on canvas 15.32:1, `muted-ink` 5.53:1, `brand-fg` on `brand` 5.41:1,
  `fascia-foreground/50` on fascia 4.81:1. Small brand-coloured text was moved to ink with
  an orange decoration; brand orange remains for fills, rules and icons (≥3:1).
- **No horizontal scroll** at 360/375/390/768/1024/1440 (measured `scrollWidth === clientWidth`).
- **No console errors** on any route, and no failed requests.
- **Photos**: lazy-loaded below the fold with intrinsic dimensions; the hero is type-led.

## 7. What is not proven, and why

- **The POS logo was not screenshot-captured.** The Electron renderer waits for the preload
  bridge ("Starting the terminal…") and cannot render the login without Forge. The images
  are committed in `desktop/public`, type-checked, bundled, and included in the packaged
  build; a human should open the till once and confirm the header.
- **The photography is licensed stock, not Sceptre Drive's own.** Provenance and licences
  are in `web/CREDITS.md`; the operator can replace files without a code change.
- **Branch contact details are the development seed's.** Real addresses, hours and phone
  numbers are edited in Settings → Website and the branch form; nothing was invented for
  the site.
- **Deployment of `web` is not wired.** Caddy, a subdomain and the `WEB_API_URL`/
  `VITE_SITE_URL` production values belong to Phase 15's infra work.
- **The store does not exist.** `/shop` is a teaser; no price, stock, cart, checkout,
  account or payment surface was built. That is the operator's decision for this phase.
- **A vector logo was not supplied.** The raster is sharp at header sizes; a future SVG/AI
  export should replace the master and regenerate the icon.

## 8. Commits

- `docs(planning): plan phase 16 web presence`
- `feat(brand): add the Sceptre Drive logo set and wire all three apps`
- `feat(site): add the public site contract and endpoint`
- `feat(admin): add the Website settings group and long-copy control`
- `feat(web): add the console-managed public website`
- `docs(planning): verify phase 16`
