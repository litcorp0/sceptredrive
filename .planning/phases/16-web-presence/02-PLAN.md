---
phase: 16-web-presence
plan: 02
title: Shared contract, web.* settings and the public site endpoint
lane: api
depends_on: [01]
requirements: [WEB-02, WEB-03, WEB-05, WEB-06, WEB-09]
---

# Plan 02 — One contract, one registry, one public read

## Goal

`GET /api/public/site` returns a typed, whitelisted projection of the business content,
resolved from `web.*` settings and the branch master, with defaults that make the site valid
before the first edit. The shared type is the only place a field name is defined.

## Read first

- `00-DECISIONS.md` P16-D4…D8, D17, D18.
- `01-RESEARCH.md` §2.1–§2.3.
- `api/src/modules/platform/settings.validation.ts:52` (the definitions shape).
- `api/src/modules/platform/settings.service.ts:24-110` (`writableByOf`, `getSettingValue`,
  `listSettings`).
- `api/src/modules/org/branches.schema.ts:18-27` and `branches.repository.ts:37-45`.
- `api/src/app.ts:99-112` (mounting) and `api/src/http/rate-limit.ts:28`.
- `api/src/modules/platform/platform.test.ts:1-120` (the integration harness).

## Tasks

### 1. Shared contract

`packages/shared/src/site.ts`:

- `SHOP_STATUSES = ['COMING_SOON', 'OPEN'] as const` plus a label map.
- `SiteBranch` — `code`, `name`, `city`, `area`, `address`, `phone`, `hours`, `mapUrl`.
- `SiteContent` — `site` (name, tagline, heroHeading, heroBody, aboutBody, announcement,
  shopStatus, contactEmail, contactPhone, whatsapp, social { instagram, facebook, tiktok })
  and `branches: SiteBranch[]`, `updatedAt`.
- Export from `packages/shared/src/index.ts`.
- Unit test: the fallback defaults parse as `SiteContent`, social/optional fields allow
  empty strings, and a shop status outside the union is not assignable.

### 2. Settings

`api/src/modules/platform/settings.validation.ts` gains the fifteen `web.*` definitions:

- Text: `web.siteName` (1–80), `web.tagline` (1–120), `web.heroHeading` (1–120),
  `web.heroBody` (1–400), `web.aboutBody` (1–2000), `web.announcement` (0–160).
- `web.shopStatus`: `z.enum(SHOP_STATUSES)`, default `COMING_SOON`.
- Contact: `web.contactEmail` (`z.email()`, default `''`? No — a valid default
  `hello@sceptredrive.example` is a placeholder that must be replaced; use an empty-able
  email and let the UI hide the action when empty). Implement as
  `z.union([z.literal(''), z.email()])`.
- Phone/WhatsApp: `z.union([z.literal(''), z.string().trim().regex(/^\+?[0-9][0-9 -]{6,19}$/)])`.
- Social: `z.union([z.literal(''), z.url().startsWith('https://')])` for each.
- Branch-scoped, `writableBy: 'admin'`: `web.branchHours` (0–120, default `''`),
  `web.branchMapUrl` (empty or https URL).
- `FLAG_SETTING_KEYS_ARE_EXACT` is untouched; these are not flags.

### 3. Branch public read

`api/src/modules/org/branches.service.ts` gains `listPublicBranches()`: active `RETAIL`
branches ordered by name, selecting only the public columns plus `address`/`phone`. No
session argument; it is a data read used by the site service, not a user-facing route.

### 4. Site module

`api/src/modules/site/` (read-only facade, no table):

- `site.types.ts` — the response type imported from `@sceptre/shared`.
- `site.service.ts` — resolve each `web.*` key with `getSettingValue`, map the branches,
  apply `updatedAt` = the newest of the resolved settings' audit times (or `new Date()` when
  all are defaults; the value only drives caching/ETag, not a displayed fact).
- `site.controller.ts` — `c.header('Cache-Control', …)`, return `{ content }`.
- `site.routes.ts` — `GET /api/public/site`, `rateLimit({ windowMs: 60_000, max: 120,
  keyPrefix: 'public:site' })`, **no** `requireSession`.
- `site.service.test.ts` / `site.test.ts` — see verification.

Mount `siteRoutes` in `api/src/app.ts` beside the other public reads.

### 5. Whitelist proof

The mapper constructs every field explicitly. A test inserts a `web.*` row with an
unexpected extra property and asserts it cannot appear; it also asserts the JSON has no
`key`, `source`, `writableBy`, `branchScoped` or `id` fields.

## Verification

- `GET /api/public/site` with no cookie returns 200 and the full object.
- Defaults: before any edit, the response matches the defaults (including `COMING_SOON`).
- A branch override wins for `web.branchHours`; the global value is used otherwise.
- Inactive branches and warehouses are absent; a retail branch's `address`/`phone` match
  the branch master.
- Rate limit: the 121st request in a minute is 429.
- Headers: `Cache-Control: public, max-age=60, stale-while-revalidate=300`.
- `setting.updated` audit exists after an edit through `PATCH /api/settings`.
- `bun run --filter api test` green; `bun run check-types` green.

## Write set

`packages/shared/src/site.ts`, `packages/shared/src/site.test.ts`,
`packages/shared/src/index.ts`, `api/src/modules/platform/settings.validation.ts`,
`api/src/modules/org/branches.service.ts`, `api/src/modules/org/branches.repository.ts`,
`api/src/modules/site/**`, `api/src/app.ts`, `api/src/modules/site/site.test.ts`.
