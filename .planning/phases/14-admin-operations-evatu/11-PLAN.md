---
phase: 14-admin-operations-evatu
plan: 11
title: Console — the whole settings surface, the flags, and who may do what
lane: admin
depends_on: [02]
requirements: [ADM-08]
---

# Plan 11 — Every setting the server has, and no key silently dropped

## Goal

The settings screen renders **every** key the API returns — 51 today — grouped by prefix,
searchable, each with its effective value, its source and who may write it. The three flags
appear at the top as switches. A read-only permission matrix answers "what can a manager
do?" from the same table the API enforces. The audit viewer's columns include the terminal
and the request id that a support ticket needs.

## Read first

- `00-DECISIONS.md` P14-D41 to D45.
- `01-RESEARCH.md` facts 41–46, 49–57.
- `admin/src/modules/settings/pages/settings-page.tsx:15-266` — the 19-key metadata list,
  the source badge, the branch-null behaviour at `:238`.
- `admin/src/modules/settings/types/index.ts:1-27` — the union that drops the rest.
- `admin/src/modules/settings/ui/setting-row.tsx:50-61`, `:112-114`.
- `admin/src/modules/settings/api/settings.ts:7-23`.
- `api/src/modules/platform/settings.service.ts:110-232` — `listSettings`, `updateSetting`,
  the `writableBy` and branch rules.
- `packages/shared/src/flags.ts` (Plan 01) — `FLAG_KEYS`, `FLAG_DEFAULTS`,
  `FLAG_DESCRIPTIONS`.
- `packages/shared/src/permissions.ts:130-138` — `ROLE_PERMISSIONS`, `can`.
- `admin/src/lib/branch-context.tsx:37-79` — the branch switcher and "all".
- `admin/src/modules/audit/pages/audit-page.tsx:145-288`.

## Tasks

### 1. Render what the server sends

Delete the hand-maintained 19-key filter. `SettingsPage` maps over `settings.settings` and
renders a row for **every** entry. `SETTING_META` survives only as presentation hints
(label, help text, control type: `text | number | boolean | enum`) and an unknown key falls
back to a plain text input labelled with its key — never dropped.

This is the structural fix for research fact 42: a new server setting can be ugly on the
day it lands, but it cannot be invisible. The walkthrough asserts the rendered row count
equals the API's key count, which is the test that would have caught the 27 missing keys.

### 2. Groups from the key, not from a list

Group by the prefix before the first dot (`auth`, `staff`, `receipt`, `loyalty`, `credit`,
`catalog`, `pricing`, `inventory`, `supplier`, `payable`, `procurement`, `pos`, `tax`,
`flag`), with a display name and a one-line description per group and the flags lifted to
their own section at the top. The order is fixed (money first: pricing, pos, credit,
loyalty; then inventory, procurement, supplier, payable; then tax, flags; then auth, staff,
receipt). A group with no keys does not render.

### 3. Search and the row's truth

A debounced search box filters on key, label and help text. Each row shows:

- the control, prefilled with the effective value;
- a **source** badge — `Branch`, `Global`, `Default` — from the API, unchanged from today;
- `writableBy` in words: *"Branch managers may change this"* or *"Administrators only"*;
- when the caller may not write it, the control is disabled with the reason, as today.

### 4. A global override is explicit

For a branch-scoped key, the row has a small scope selector: **This branch** (default when
a branch is selected) or **All branches**. "All branches" is a switch that must be turned
on, and while it is on the save button reads *"Set for every branch"*. With the branch
switcher on "all", the row defaults to read-only with the hint to pick a branch — the
silent global write at `settings-page.tsx:238` becomes impossible by construction
(P14-D43).

### 5. The flags

`components/flag-switches.tsx` renders one row per `FLAG_KEYS` entry: a `Switch`, the
label, and `FLAG_DESCRIPTIONS[key]`. Each change is one `PATCH /api/settings` with the key
and the boolean, so the existing audit row (`setting.updated`, before/after) is the record.
A flag whose server row is absent shows `Default` as its source and its default as its
value — toggling it writes the row.

### 6. The permission matrix

`staff/pages/permissions-page.tsx` at `/staff/permissions`, permission `staff.read`:

- three columns (`Admin`, `Manager`, `Cashier`) and one row per `PERMISSIONS` entry, grouped
  by prefix;
- a tick where `can(role, permission)` is true, rendered with an `aria-label` rather than a
  bare glyph;
- a header line stating that the table is generated from the same constant the API's
  middleware uses, and that the console's own checks are cosmetic;
- the counts (66 / 54 / 0) as a caption.

No editing. A fixed three-role matrix is the design (locked D7); a screen that could edit it
would be a lie about the permission model.

### 7. Audit viewer polish

Columns become: time, action, entity, entity id (truncated with a copy control), actor staff
id or `system`, branch, terminal, request id. The before/after diff stays in the expander.
The Export button from Plan 09 sits in the header, with the caption that the file never
contains the payloads.

A `Link` on the entity id is **not** added: the entity names are free text written by a
dozen modules, and a mapping table that guesses is worse than a copy control.

### 8. Walkthrough

`walkthrough-sections.mjs`: `/settings` asserts the rendered row count equals the API
response's `settings.length` and that at least one `Default`-sourced flag is present;
`/staff/permissions` asserts 66 rows and the three column headers; `/audit` asserts the new
terminal and request-id columns render for a seeded row. One screenshot each.

## Verification

```bash
bun run --filter admin check-types
bun run --filter admin build
bun run modules:check:strict
bun run lint
```

By hand: toggle `flag.supplierTransfers` off, confirm Plan 10's action disappears on the
payments page after a refetch, toggle it back, and find two `setting.updated` rows in the
audit log with the before and after.

## Commits

1. `feat(admin): the settings screen renders every key the server defines`
2. `feat(admin): settings grouped by prefix, searchable, with writableBy in words`
3. `feat(admin): a branch-scoped setting cannot be made global by accident`
4. `feat(admin): the three flags are switches with sentences`
5. `feat(admin): a read-only permission matrix generated from the shared table`
6. `feat(admin): the audit viewer names the terminal and the request`
7. `test(admin): key parity, the matrix, and the flag toggle`

## Done when

- Adding a setting on the server makes it visible in the console with no console change.
- An admin can see, in one place, exactly which settings a manager may change.
- Turning a feature off is a switch with an audit row, not a deploy.
