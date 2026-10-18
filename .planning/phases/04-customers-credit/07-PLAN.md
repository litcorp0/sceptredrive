---
phase: 04-customers-credit
plan: 07
wave: 6
title: Console — loyalty history, liability report, and settings
requirements: [LOY-01..06, ADM-05]
depends_on: [04, 05, 06]
status: planned
created: 2026-10-18
---

# Plan 07 — Console Loyalty, Liability, Settings

**Goal:** Loyalty is as visible as credit: balance, lots, and history on the customer
profile; reason-coded staff adjustments; a liability report with branch activity and
flagged negative balances; and the Phase 4 settings surfaced with clear labels.

## Task 1 — Loyalty on the customer profile

**Files:** `admin/src/routes/_authenticated/customers/$id.tsx`,
`admin/src/components/customers/loyalty-card.tsx`,
`admin/src/components/customers/loyalty-history-table.tsx`,
`admin/src/components/customers/loyalty-adjust-dialog.tsx`,
`admin/src/lib/api.ts`, `admin/src/lib/api-types.ts`

- Loyalty card: balance (points + implied GHS value at the current rate), “Adjust”
  button (`loyalty.adjust`); lots table: points, remaining, expires at (with an
  “expiring soon” hint within 30 days); history table: date, kind badge
  (Earn/Redeem/Clawback/Adjust/Expire), points signed, reason, branch, reference.
- Adjust dialog: kind select (Earn / Adjust / Clawback / Redeem), points, reason select
  (Goodwill / Correction / Other; Return for clawback), note, idempotency handled by the
  client; server 409s (minimum redemption, insufficient balance) surface inline.
- Redeem helper text shows the quoted GHS value for the entered points (from the API
  `quoteRedeem` — either returned by the entries response or computed with the settings
  rate; prefer the server number).
- Query keys `['loyalty-account', customerId]`; invalidate on mutation.

**Verify:** earn points → balance and lot appear; redeem FEFO → earliest lot shrinks
first; clawback with insufficient points shows the negative balance warning; adjust with
reason; history matches the ledger.
**Commit:** `feat(admin): add loyalty history and adjustments`

## Task 2 — Loyalty liability report

**Files:** `admin/src/routes/_authenticated/loyalty.tsx`,
`admin/src/components/layout/sidebar.tsx`,
`admin/src/components/customers/liability-report.tsx`,
`admin/src/lib/api.ts`, `admin/src/lib/api-types.ts`

- Sidebar entry “Loyalty” (icon `Gift`, `loyalty.read`); page with a date range:
  headline cards (outstanding points, GHS liability at the current rate, points
  expiring in the next 30 days), per-branch activity table (earned, redeemed, clawed
  back, adjusted, expired), and a “Negative balances” review list linking to the
  customer profiles.
- Admin sees all branches; manager sees own-branch activity and the global headline
  (the balance is global by design) — enforced server-side, the UI just renders scope.

**Verify:** numbers reconcile with the demo/loyalty fixtures; expiring-soon card reacts
to a lot with a near expiry; negative-balance row links to the profile.
**Commit:** `feat(admin): add loyalty liability report`

## Task 3 — Settings page Phase 4 additions

**Files:** `admin/src/routes/_authenticated/settings.tsx`,
`admin/src/components/common/settings-*` (existing pattern),
`admin/src/lib/api-types.ts`

- Surface the new keys with labels/help: `loyalty.minimumRedeemPoints` (whole points),
  `credit.repaymentPrefix`, `credit.repaymentSequence`; verify `loyalty.earnPointsPerCedi`
  now renders as an integer field and fractional input is rejected by the server.
- Group under Loyalty and Credit sections; admin-only editing (existing rule) — hidden
  or disabled for managers with an explanatory tooltip.

**Verify:** admin edits minimum redemption to 200 → a 100-point redeem is rejected
(409) in the profile dialog; manager sees the section read-only; prefix/sequence render
and update with audit rows.
**Commit:** `feat(admin): surface phase 4 settings`

## Done When

Loyalty balances, lots, and history are visible and reason-coded adjustments are operable
from the console; the liability report gives admin and managers their scoped view; and
Phase 4 settings are editable with clear labels and correct validation.
