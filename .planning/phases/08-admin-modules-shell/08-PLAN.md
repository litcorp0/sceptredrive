---
phase: 08-admin-modules-shell
plan: 08
wave: 8
title: Loyalty module — liability, history, adjustments
requirements: [UIX-06]
depends_on: [07]
status: planned
created: 2026-10-24
---

# Plan 08 — `modules/loyalty`

**Goal:** Loyalty leaves the `components/customers` folder it has shared since Phase 4 and
becomes a module with one page, one report, and the card the customer profile embeds.

## Task 1 — API, keys, types, utils

**Files:** new `admin/src/modules/loyalty/{api,types,utils}`; `lib/api.ts`; `lib/api-types.ts`;
`admin/src/lib/loyalty.ts` (moved to `modules/loyalty/utils/loyalty.ts`)

- `api/keys.ts`: `loyaltyKeys` with the measured roots `loyalty-account`, `loyalty-history`,
  `loyalty-liability`.
- `api/loyalty.ts` takes the `api.loyalty` group verbatim (lines 328–338 of `lib/api.ts`).
- `types/`: `LoyaltyAccountDetail`, `LoyaltyEntry`, `LoyaltyEntryKind`, `LoyaltyReasonCode`,
  `LoyaltyStaffKind`, `LoyaltyEntryCreateInput`, `LoyaltyPostingResult`,
  `LoyaltyLiabilityQuery`, `LoyaltyLiabilityReport`, `CustomerLoyaltySummary` (moved from the
  customers block — it is loyalty's summary surfaced on a customer).
- `utils/loyalty.ts` is `lib/loyalty.ts` moved whole: label/tone maps, `EXPIRING_SOON_DAYS`, and
  the expiring-lot helpers built on `differenceInCalendarDays`. Points are integers; no helper
  may introduce a float.
- `lib/loyalty.ts` is deleted and its importers updated.

**Verify:** `grep -rn "lib/loyalty" admin/src` returns nothing; labels and tones are unchanged
(Earn green, Redeem blue, Clawback amber, Adjust zinc, Expire red).

**Commit:** `refactor(admin): add the loyalty module api, types, and utils`

## Task 2 — Components and the liability page

**Files:** `modules/loyalty/components/{loyalty-card,loyalty-history-table,loyalty-adjust-dialog,liability-report}.tsx`
(moved from `components/customers/`), `modules/loyalty/pages/loyalty-page.tsx`,
`routes/_authenticated/loyalty.tsx`, `routes/_authenticated/customers/$id/index.tsx`
(import specifiers only), `index.ts`

- Move the four components verbatim. `loyalty-card` is the profile's loyalty tab; the customer
  detail route flips its import to `#/modules/loyalty` — imports only, body untouched (Plan 09).
- `pages/loyalty-page.tsx` from `loyalty.tsx` (81 lines): branch/period inputs plus the liability
  report. Keep the 30-day expiring window and the headline figures exactly.
- `liability-report` stays presentational: it receives the report from the page and renders it.
  It must not fetch — that is the `ui` vs `components` line in practice.
- Preserve: adjust with reason code, staff-kind attribution, and the redemption minimum notice.

**Verify:** the liability report's totals equal the sum of the branch's loyalty accounts (spot-check
the demo seed); adjust a balance and see the report and history update; the customer profile's
loyalty tab still renders from the barrel; `bun run modules:check` passes with ten modules
migrated.

**Commit:** `refactor(admin): move loyalty into the loyalty module`

## Task 3 — Clear the name

**Files:** `scripts/check-modules.mjs` (**controller-owned**), `admin/biome.json`

**Verify:** `bun run lint`, `bun run check-types`, `bun run --filter admin build` green; root
`bun run test` unchanged; append to `evidence/suites.txt`.

**Commit:** `chore(admin): record loyalty as migrated`

## Definition of Done

- Loyalty owns its API, keys, types, utils, four components, and one page.
- Points remain integers; the expiry helpers still come from `date-fns` through the shared layer.
- Nothing under `components/customers/` is loyalty's any more — only the customer and credit
  files remain, ready for Plan 09.
