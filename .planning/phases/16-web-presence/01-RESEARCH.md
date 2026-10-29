# Phase 16 — Research

Read once, do not repeat. §1 is external (the documents the plans are built on). §2 is the
repository, verified against the tree on 2026-10-29 with paths and line ranges. §3 is the
supplied artwork and the extraction already proven in a scratch directory.

`00-CONTEXT.md` is locked; `00-DECISIONS.md` refines it and wins where they disagree.

**Baseline at planning time:** shared **348** tests, API **841** tests, desktop **615**,
admin modules **21/21**, POS modules **16/16**, brand gate **1 201** files, `check-types`
6/6, `lint` exit 0 with 19 pre-existing warnings.

---

## 1. Official sources

| # | Source | What it settles |
|---|---|---|
| S1 | [TanStack CLI — create](https://github.com/TanStack/cli#readme) | `npx @tanstack/cli create web`; `--blank -y`; the generated project carries its own lockfile/install, which a workspace must discard. |
| S2 | [TanStack Start — quick start](https://tanstack.com/start/latest/docs/framework/react/quick-start) | The scaffold is the CLI or an official example; file routes live under `src/routes`, the root shell is `__root.tsx`. |
| S3 | [TanStack Start — server functions](https://tanstack.com/start/latest/docs/framework/react/guide/server-functions) | `createServerFn({ method: 'GET' }).handler(...)` runs on the server during SSR and is proxied on client navigation. `getRequestHeader` is server-only. The admin already uses this shape (`admin/src/lib/session.functions.ts`). |
| S4 | [TanStack Router — file-based routing](https://tanstack.com/router/latest/docs/framework/react/routing/file-based-routing) | `createFileRoute('/parts')`, `head()` per route, `validateSearch` for the parts filter. |
| S5 | [Vite — `resolve.dedupe`](https://vite.dev/config/shared-options#resolve-dedupe) | A monorepo with more than one React path resolves the duplicate unless deduped; the admin config documents the same decision at `admin/vite.config.ts`. |
| S6 | [Vite — dependency optimizer](https://vite.dev/guide/dep-pre-bundling) | Pre-bundled deps are keyed by a config/lock hash; a re-optimization can replace chunks mid-session, which is the duplicate-React failure fixed in `6dc21b9`. Pinning one React version is the durable fix. |
| S7 | [ImageMagick — flood fill](https://imagemagick.org/Usage/draw/#color) and [`-trim`](https://imagemagick.org/Usage/crop/#trim) | `-fuzz N% -fill none -draw 'color X,Y floodfill'` removes only the connected background; `-trim +repage` crops to content. Proven on this artwork in §3. |
| S8 | [WCAG 2.2](https://www.w3.org/TR/WCAG22/) | 1.4.3 contrast 4.5:1 body / 3:1 large; 2.4.7 visible focus; 2.4.11 focus not obscured; 2.5.8 target size 24×24 (the site uses 44 px); 2.3.3 animation from interactions; 1.4.12 text spacing. |
| S9 | [schema.org — AutoPartsStore](https://schema.org/AutoPartsStore) and [LocalBusiness](https://schema.org/LocalBusiness) | The JSON-LD type and the fields used: `name`, `url`, `telephone`, `email`, `address`, `openingHours`, `sameAs`. |
| S10 | [Unsplash License](https://unsplash.com/license) | Photos may be used commercially without permission; attribution is not required but is recorded in `CREDITS.md`. |
| S11 | [Bun — workspaces and catalog](https://bun.sh/docs/install/workspaces) | `workspaces.packages` plus `"catalog:"` references; one root lockfile. The root already uses this (`package.json`). |
| S12 | [Hono — secure headers and context](https://hono.dev/docs/guides/middleware) | Route-level middleware composition; `c.header()` sets the cache headers per response. The API already applies `securityHeaders` globally (`api/src/app.ts:83`). |

### 1.1 The external facts that change the design

1. **A server function keeps the API URL off the client.** The site's content loader must
   not become a browser `fetch` to `:4000` — that would need CORS for a marketing page and
   would expose the API host to every visitor. The loader calls a `createServerFn` that
   fetches server-side; the client receives serialized content only (S3).
2. **One React version is the fix, not a dedupe alone.** The optimizer can re-bundle mid
   session; `resolve.dedupe` handles resolution but a second copy installed on disk still
   exists (S5, S6). The web workspace references the catalog and the admin's exact
   TanStack versions.
3. **Background removal must be a flood fill, not a colour key.** A global
   `-transparent '#F0F0F0'` would also erase the near-white highlight inside the wrench.
   The corners are connected to the outside; the enclosed highlights are not (S7, §3).
4. **`AutoPartsStore` is a `LocalBusiness`.** The JSON-LD can carry the branch list as
   `department`/`location` entries with `openingHours`; one graph, not two competing
   scripts (S9).
5. **Attribution is a credit file, not a footer link.** Unsplash does not require it, but
   the repository records provenance for every downloaded asset (S10, P16-D10).

---

## 2. Repository facts

### 2.1 Settings registry and console

1. `SETTING_DEFINITIONS` is declared at `api/src/modules/platform/settings.validation.ts:52`
   and every key is a `{ schema, defaultValue, branchScoped, writableBy? }`. A key without
   `writableBy` is admin-only when global and manager-writable when branch-scoped
   (`settings.service.ts:24-30`). `web.branchHours` / `web.branchMapUrl` therefore set
   `writableBy: 'admin'` explicitly (P16-D5).
2. Writes go through `updateSetting` (`settings.service.ts:120`): unknown key → 400,
   permission check, branch access check, Zod parse, audit `setting.updated` with
   before/after. New keys inherit all of it; no new write path is needed.
3. `GET /api/settings` returns **every** definition resolved for the selected branch
   (`settings.service.ts:104-110`). The console page renders the response rather than a
   hard-coded list (`admin/src/modules/settings/pages/settings-page.tsx:27-30`).
4. The console groups keys by the prefix before the first dot
   (`admin/src/modules/settings/utils/settings.ts:5-13`); a `web` prefix missing from
   `GROUP_META`/`GROUP_ORDER` still renders, appended alphabetically, labelled "Web". To
   make it deliberate, add a "Website" entry and a position in `GROUP_ORDER:55`.
5. Presentation hints are optional (`admin/src/modules/settings/utils/meta.ts:10`);
   `controlFor` (`:279`) maps `boolean` → switch, `number` → number, else text. There is no
   long-text control today; `SettingControl` is
   `"text" | "number" | "boolean" | "select" | "money"` (`admin/src/modules/settings/types/index.ts:36`).
   P16-D20 adds `textarea`.
6. The settings page's rows carry the source badge and the branch/all scope rules
   (`settings-page.tsx` plus `utils/settings.ts:86-110`); an admin writing a branch-scoped
   key must pick a branch.

### 2.2 Branches

7. `branch` already has `address`, `phone`, `city`, `area`, `type`, `isActive`
   (`api/src/modules/org/branches.schema.ts:18-27`). No migration is needed for contact
   details.
8. Active branch rows are read by `listActiveBranchDirectoryRows`
   (`branches.repository.ts:37-45`); the directory result is what the console uses.
   A public projection can reuse the same select and filter `type = RETAIL`.
9. The admin branch form edits address and phone
   (`admin/src/modules/branches/components/edit-branch-form.tsx:121-133`); the create dialog
   does too (`create-branch-dialog.tsx:42-75`). The site should not duplicate them.
10. Warehouses are stock-only and must not appear as customer locations
    (`PROJECT.md`, INV-09; the demo seed seeds `ACC-WH1` without a terminal).

### 2.3 Public surface, rate limiting, CORS

11. Routes are mounted in `api/src/app.ts:99-112` after `loadSession`, `securityHeaders`
    and `corsMiddleware`. A public route simply does not call `requireSession`; there is no
    global session gate to bypass.
12. The rate-limit middleware is `rateLimit({ windowMs, max, keyPrefix, keyForRequest? })`
    (`api/src/http/rate-limit.ts:28`); it keys on the client IP from headers and returns
    429 with `Retry-After` through the shared error path.
13. Dev CORS already allows `http://localhost:5173` (`api/src/config/env.ts:173-178`), the
    port the web dev server uses. Production CORS is an explicit env list, unchanged.
14. `GET /api/public/site` is unauthenticated and must be treated as hostile input: no key
    names, no `source`, no staff, no customers, no internal flags. `web.service.ts` maps
    into `SiteContent` explicitly; it never spreads a settings row.

### 2.4 Brand and gates

15. `packages/brand/src/tokens.css` defines `--ink #1B1F23`, `--brand #F26A1B`,
    `--canvas #F6F6F4`, `--surface #FFFFFF`, `--muted-ink #5C6470`, `--line`, the shadcn
    map and the chart ramp; `fonts.css` defines Space Grotesk / Inter / JetBrains Mono.
    The contrast pairs are measured in the file's header.
16. `scripts/check-tokens.mjs:27-36` lists `APPS = ['admin', 'desktop']`,
    `APP_STYLESHEETS` and `APP_SOURCE_DIRS`. Adding `web` makes the gate require the
    token import and forbid a brand hex in `web/src`.
17. Root `biome.json` was given an uncommitted `"!web"` exclusion on 2026-10-29 because the
    CLI scaffold broke `bun run lint` (recorded in `STATE.md`). P16-D21 removes the
    exclusion and gives `web` its own `biome.json` with `root: false, extends: '//'`, the
    same pattern as `admin/biome.json`.
18. `bun run build` and `bun run check-types` fan out to every workspace with the script;
    `bun run test` runs each workspace's `test`. `web` must provide all three or it is
    invisible to CI.
19. The brand gate scans tracked files for the pre-rename string only
    (`scripts/check-brand.mjs`); a new workspace needs no edit there.
20. The admin has no unit-test runner; the web will add **vitest** (already in the root
    catalog at 5.0.5) for the loader/fallback/formatting units. `bun run test` picks it up.

### 2.5 Logo placement points

21. Admin sidebar header: `admin/src/components/layout/sidebar.tsx:351-367` (an `SD` tile
    plus two lines of text). Expanded: replace the tile+text with the lockup; collapsed
    (`group-data-[collapsible=icon]`): keep the tile.
22. Admin auth shell: `admin/src/modules/auth/components/auth-shell.tsx:17-32` (the same
    `SD` tile and text above every auth card).
23. Admin document head: `admin/src/routes/__root.tsx:33-49` — `links` is the favicon's
    home; there is no icon today.
24. Desktop header: `desktop/src/renderer/components/layout/app-header.tsx:47-75` — a
    charcoal strip with the branch eyebrow and the terminal code; the brand block is the
    natural logo slot. Text colour there is `--topbar-foreground`.
25. Desktop login: the dark aside at
    `desktop/src/renderer/modules/auth/pages/login-page.tsx:185-200` ("Sceptre Drive POS"),
    and the light forms at `:600-700` (`EnrollmentScreen`, `CredentialProblemScreen`).
26. Both Vite clients serve `public/` at `/`; a copied `logo.png` is available as
    `/logo.png` in dev and in the built app. The desktop CSP does not restrict
    `img-src` to `self` only? It does — but `/logo.png` is same-origin on `app://`.

### 2.6 Web scaffold (operator-created, untracked)

27. `/web` was created on 2026-10-29 by `npx @tanstack/cli create web` with the default
    preset plus `biome, nitro, form, shadcn, t3env, table, tanstack-query`
    (`web/.cta.json`). It has its own `bun.lock` (123 KB) and `node_modules`.
28. Its versions are one patch ahead of the admin: `@tanstack/react-router 1.170.46`,
    `react-query 5.105.0`, `react-start 1.169.4` (admin: 1.170.45 / 5.104.4 / 1.169.3).
    React is `^19.2.0` in both; the root catalog is `19.2.0`. P16-D2 pins web to the admin
    versions and the catalog.
29. The scaffold ships a complete demo design (sea/lagoon/palm palette, Fraunces/Manrope,
    a marketing route) in `web/src/styles.css` and `web/src/routes/index.tsx`; it is a
    clean base, not user content. `src/components/ui` has button, input, label, select,
    slider, switch, textarea.
30. `web/src/env.ts` uses `@t3-oss/env-core` with `runtimeEnv: import.meta.env` and a
    `VITE_` client prefix. A server-only `WEB_API_URL` must be added through
    `process.env` in the server function, not `import.meta.env` (S3).
31. `web` is **not** in `workspaces.packages`; its packages are not in the root lockfile.
    Adding it requires deleting `web/bun.lock` and running the root install.

### 2.7 Brand-asset extraction (proven)

32. Source: `admin/public/WhatsApp Image 2026-10-23 at 6.02.43 PM.jpeg` — 1254×1254,
    sRGB, 66 048 B, corner pixel `srgb(240,240,240)`, 22 582 colours (JPEG noise).
33. `-fuzz 9% -fill none -draw 'color 0,0 floodfill'` from all four corners followed by
    `-trim +repage` yields a clean 1159×504 transparent PNG; the wordmark's interior
    remains intact. A 12 % `-opaque '#1b1f23' → #F6F6F4` recolor produces a clean inverse
    lockup on `#1B1F23` at header size (verified at 2×). The wordmark's black pixels sample
    at `~#1A1B1D`.
34. A square emblem-only crop is **not** clean: the "DRIVE" letters overlap the gear, so a
    crop keeps letter fragments. The collapsed rail therefore keeps the documented `SD`
    monogram, and the favicon is the lockup padded in a square (P16-D13).
35. The raster is sharp to roughly 360 px wide. The site uses it at 120–220 px in the
    header/footer; a vehicle-sized hero is typography, not a stretched logo.
