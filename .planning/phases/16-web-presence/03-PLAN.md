---
phase: 16-web-presence
plan: 03
title: Console — the Website group and the long-copy control
lane: admin
depends_on: [02]
requirements: [WEB-04, WEB-10]
---

# Plan 03 — Console: the Website group and the long-copy control

## Goal

An administrator opens **Settings**, sees a "Website" group, and edits every public field
with a label and a sentence of help. Long copy gets a textarea; the write still goes through
the one audited settings path.

## Read first

- `00-DECISIONS.md` P16-D3, D20.
- `00-CONTEXT.md` "Open Items" (placeholders).
- `admin/src/modules/settings/utils/settings.ts:11-70` (group metadata and order).
- `admin/src/modules/settings/utils/meta.ts:279-284` (`controlFor`).
- `admin/src/modules/settings/types/index.ts:36` (`SettingControl`).
- `admin/src/modules/settings/ui/setting-row.tsx:120-260` (the row's control branch).
- `admin/src/modules/settings/pages/settings-page.tsx` (the page that renders groups).

## Tasks

### 1. The textarea control

- Add `"textarea"` to `SettingControl` and to `controlFor` when `meta.control ===
  "textarea"`.
- In `setting-row.tsx`, render a `<Textarea>` for it (full width, `min-h-28`, `maxLength`
  from the schema? The schema is server-side; use the meta help text and rely on the API
  for the hard limit).
- Keep the grid intact: the textarea occupies the control column on desktop and the full
  width on mobile; Save sits beneath it.
- `dirty`, `parse` (textarea is text), `aria-describedby` and the disabled state behave
  exactly like the text input.

### 2. The Website group

- `utils/settings.ts`: add
  `web: { label: "Website", description: "The public site: identity, contact, the shop notice and per-branch hours." }`
  to `GROUP_META`, and `"web"` to `GROUP_ORDER` after `"receipt"` (the groups a person
  changes together sit together; website sits with the other outward-facing copy).
- `utils/meta.ts`: one entry per `web.*` key with a label and a help sentence:
  - `web.siteName`, `web.tagline`, `web.heroHeading` (text), `web.heroBody` (textarea),
    `web.aboutBody` (textarea), `web.announcement` (text; empty hides the bar),
    `web.shopStatus` (select: `COMING_SOON` = "Shop coming soon", `OPEN` = "Shop open"),
    `web.contactEmail`, `web.contactPhone`, `web.whatsapp`, `web.instagram`,
    `web.facebook`, `web.tiktok` (text), `web.branchHours`, `web.branchMapUrl` (text).
  - The branch-scoped pair says "Set per branch" in the description.
- The page already hides a group with no keys; no page edit is expected. If the group order
  test in `settings-page` asserts a count, update it.

### 3. Empty-value behaviour

An empty contact field hides the corresponding action on the site; the help text says so.
`web.announcement` empty hides the announcement bar. No "unset" sentinel is introduced.

## Verification

- `bun run --filter admin check-types` and `bun run --filter admin lint` green.
- Open `/settings` as an admin: the Website group is present with 15 rows, the two long
  fields render textareas, and a save round-trips.
- Open `/settings` as a manager: the website rows are read-only with the admin-only
  sentence, and no manager can write a global value.
- The `setting.updated` audit entry names the key and carries before/after.
- A branch-scoped row (hours/map) shows the branch/all switch only for an admin.

## Write set

`admin/src/modules/settings/types/index.ts`, `admin/src/modules/settings/utils/settings.ts`,
`admin/src/modules/settings/utils/meta.ts`, `admin/src/modules/settings/ui/setting-row.tsx`,
`admin/src/modules/settings/pages/settings-page.tsx` (only if a count/assertion needs it),
`admin/test/walkthrough-sections.mjs` (the settings leg).
