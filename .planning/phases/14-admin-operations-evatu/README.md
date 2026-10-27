# Phase 14 — Admin Operations & E-VAT

Thirteen plans. Plans are prompts: execute one at a time, commit atomically, verify
before moving on. `00-CONTEXT.md` is the locked frame; `00-DECISIONS.md` refines it and
**wins where the two disagree**. `01-RESEARCH.md` is the source list and the verified
repository facts — read it once, do not repeat it.

| Plan | Title | Lane | Depends on |
|---|---|---|---|
| 01 | Shared vocabulary: permissions, flags, conflict, transfer and E-VAT labels | shared | — |
| 02 | Schema: conflict resolution, supplier transfers, E-VAT submissions, settings | api | 01 |
| 03 | Oversight reads: sales, refunds, shifts, the receipt copy, cart voids | api | 02 |
| 04 | Conflict queue and resolution | api | 03 |
| 05 | Reports: stock, ageing exports, audit export, printable sheets | api | 02 |
| 06 | Supplier transfers: recipients, initiation, OTP, webhook, settlement | api | 02 |
| 07 | E-VAT: provider seam, mock, submission queue, retry, deadline | api | 02 |
| 08 | Console: the `pos-oversight` module and the receipt copy | admin | 03, 04 |
| 09 | Console: exports and printable reports across five modules | admin | 05 |
| 10 | Console: supplier transfers and the E-VAT failure surface | admin | 06, 07 |
| 11 | Console: the full settings surface, feature flags, audit viewer | admin | 02 |
| 12 | Desktop: the printed Z itemises cash refunds; a manager may close | desktop | 01, 03 |
| 13 | Verification, evidence, state update | verification | 12 |

## Why this order

- **01 is alone and first.** `packages/shared` is imported by both clients and the API.
  Plan 01 adds six permissions (and updates the count assertions that guard them), the
  `flag.*` registry, and the label maps that stop the console, the API and the till from
  naming the same status two ways. A lane writing into `packages/` while another builds
  against it is the collision this repository does not survive.
- **02 before every other API plan.** No service can be written against a table that does
  not exist, and four new enums must land in their own migration file before any DDL or
  default uses them (research fact 48 — the rule is architectural, not stylistic). The new
  `supplier_transfer`, `supplier_transfer_allocation` and `evat_submission` tables are read
  by 03–11 only through HTTP.
- **03 before 04.** A conflict row's only readable context is the sale or shift it points
  at, so the oversight reads are the queue's detail pane. Building the queue first would
  mean writing the detail twice.
- **05 after 02 and independent of 03/04.** Reports read ledgers, not documents. It is
  placed before the provider plans because it is the one plan whose output a reviewer can
  check against a spreadsheet.
- **06 before 07** only for the provider seam: 07 returns a certificate where 06 returns a
  transfer, and both add a worker and an event arm to the same three files
  (`payments.provider.ts`, `app.ts`, `jobs/queues.ts`). They are one lane, so the order is
  for review, not for safety.
- **08 is the first console plan** because the oversight module is the largest and it adds
  the `/pos` section the other console plans link into.
- **09, 10, 11 follow serially.** They are one lane and they share `sidebar.tsx`,
  `styles.css` and the shared table/print primitives. 09 depends on 05, 10 on 06/07, and
  11 on 02 only — which is why 11 can start before 08 in wall-clock terms, but not in file
  terms.
- **12 is a desktop plan and the only one.** It prints the `cash_refund_minor` Plan 03
  stores, so it starts after 03 is green and runs beside the API and console work — it
  touches a different tree, and its two changes are reviewed against a settled schema.
- **13 runs when every lane is idle.** No repository-wide gate and no browser suite while
  a lane is writing.

## Execution shape — what may run in parallel

**`PARALLEL.md` is the operational map**: the eight waves, each plan's exact write set, the
named file collisions that force the serial chains, and the dispatch prompt skeleton. This
section is the summary; that file is what a controller follows.

This phase is **serial by lane, parallel by wave**. Plans 02–07 write `api/**`; 08–11 write
`admin/**`; 12 writes `desktop/**`.

| Wave | Work | Lanes | Why it is safe |
|---|---|---|---|
| 1 | **01 alone** | shared | `packages/**` is imported by both clients; it goes first and alone |
| 2 | **02 alone** | api | creates every enum, table and setting the rest reads |
| 3 | 03 → 04 | api | one lane, `pos.*` files; 04 writes the resolution path 03's detail pane reads |
| 4 | 05 ∥ 11 ∥ **12** | api, admin, desktop | 03 green (12 prints the figure 03 stores); disjoint trees |
| 5 | 06 ∥ 08 | api, admin | `payables/payments/jobs` vs `admin/src/modules/pos-oversight`; no shared file |
| 6 | 07 ∥ 09 | api, admin | `evat/**` vs `inventory/credit/payables/loyalty` admin modules; no shared file |
| 7 | **10** | admin | consumes 06 and 07; the console lane is otherwise idle |
| 8 | **13** | verification | read-only; needs the stack up and every lane idle |

**Admin is one lane.** 11 → 08 → 09 → 10 is the file order even where the wave table lets
11 start early, because all four touch `sidebar.tsx` and `styles.css` and a second writer in
that lane is the collision the lane rule exists to prevent.

**Never while a lane is writing:** `bun run modules:check:strict`, `bun run test`,
`bun run brand:check`, or any Playwright suite. Wave 8 is the only place the
repository-wide gates run.

## Lane ownership

| Lane | Owns | Plans |
|---|---|---|
| shared | `packages/**` | 01 |
| api | `api/**` (including `api/migrations`, `api/src/seed`, `api/src/app.ts`, `api/src/jobs/**`, `api/src/config/env.ts`) | 02–07 |
| admin | `admin/**` | 08–11 |
| desktop | `desktop/**` | 12 |
| controller | root `package.json`, `scripts/**`, `biome.json`, `.github/**`, `.planning/**`, `AGENTS.md`, `REQUIREMENTS.md`, `powersync/**` | `REQUIRED_MODULES` in `scripts/check-modules.mjs`; 13 |
| verification | nothing — runs gates, read-only | 13 |

Adding `pos-oversight` to `REQUIRED_MODULES` is a root-file edit. The admin lane reports
`NEEDS_LANE_CHANGE`; the controller makes the one-line edit in its own commit.

## Frozen file set

Read by every plan, written by exactly one:

| File | Owner | Plan |
|---|---|---|
| `packages/shared/src/permissions.ts`, `permissions.test.ts` | shared | 01 only |
| `packages/shared/src/flags.ts`, `conflicts.ts`, `transfers.ts`, `evat.ts` | shared | 01 only |
| `api/src/modules/platform/settings.validation.ts` | api | 02 only |
| `api/src/modules/pos/pos.schema.ts` | api | 02 only (then read) |
| `api/src/modules/platform/audit.schema.ts` | api | 02 only (no column change expected) |
| `api/src/modules/payables/payables.schema.ts` | api | 02 only |
| `api/src/modules/suppliers/suppliers.schema.ts` | api | 02 only (`paystackRecipientCode` stays as-is) |
| `api/src/modules/payments/payments.schema.ts` | api | 02 only (`supplier_transfer_id`) |
| `api/src/modules/pos/pos.routes.ts`, `pos.validation.ts` | api | 03 (oversight), 04 (conflict) — **serially** |
| `api/src/modules/pos/pos.oversight.repository.ts`, `pos.oversight.service.ts` | api | 03 only |
| `api/src/modules/pos/pos.service.ts` | api | 04 (`resolveConflict`), 03 (read-only X/Z extraction) — **serially** |
| `api/src/modules/inventory/inventory.validation.ts` | api | 05 only (movement filter) |
| `api/src/modules/payables/payables.service.ts` | api | 06 (extract the posting core) — 05 reads only |
| `api/src/modules/payments/payments.provider.ts`, `.paystack.provider.ts`, `.mock.provider.ts` | api | 06 (transfer methods), 07 (nothing — E-VAT has its own seam) |
| `api/src/modules/payments/payments.service.ts` | api | 06 (transfer events, settlement) — serially |
| `api/src/modules/evat/**` | api | 07 only |
| `api/src/app.ts` | api | 06 (transfer webhook arm), 07 (routes) — **serially** |
| `api/src/jobs/queues.ts` | api | 06 (transfer sweep), 07 (submission queue) — **serially** |
| `api/src/config/env.ts` | api | 07 only (`EVAT_*`) |
| `admin/src/components/layout/sidebar.tsx` | admin | 08 (`/pos`), 09 (`/reports` labels), 10, 11 — **serially, one lane** |
| `admin/src/modules/pos-oversight/**` | admin | 08 only |
| `admin/src/modules/payables/**`, `suppliers/**` | admin | 10 only |
| `admin/src/modules/settings/**`, `audit/**` | admin | 11 only |
| `admin/src/modules/inventory/**`, `credit/**`, `payables/**`, `loyalty/**` (export/print) | admin | 09 only — and `payables/**` is 10's, so 09 adds export there **before** 10 touches transfer UI |
| `desktop/src/renderer/lib/receipt/report-render.ts` | desktop | 12 only |
| `desktop/src/renderer/lib/shift/shift-service.ts` | desktop | 12 only |
| `scripts/check-modules.mjs` | controller | 08's `NEEDS_LANE_CHANGE` |

Two collisions are worth naming because they are not obvious:

- **`admin/src/modules/payables/**` is written by both 09 (export) and 10 (transfer UI).**
  Both are in the admin lane and 09 runs first, so the order is the rule. If the waves are
  re-ordered, 09's export button moves to a commit before 10's dialog or not at all.
- **`api/src/modules/payables/payables.service.ts` is read by 05 and written by 06.** 05
  must not refactor the posting core "while it is there". It adds a read and an export
  beside `getAging`, and nothing else.

## The three things this phase must not do

1. **Never let oversight become correction.** No screen in this phase edits a sale, a
   refund, a shift, a movement or a ledger. Conflicts are resolved with a code and a note;
   everything else is a new document or a support conversation.
2. **Never call a supplier paid before the money moved.** A transfer is an instruction; the
   `supplier_payment` is the fact, and it exists only after `transfer.success`. A failed or
   reversed transfer leaves the balance untouched and the attempt visible.
3. **Never let a certificate touch the document.** E-VAT fields live in `evat_submission`.
   `sale` and `refund` are byte-identical before and after certification, and a test says
   so.

## Verification philosophy

Every number in this phase must reconcile, so every plan's "Verification" section names the
reconciliation, not the feature:

- a receipt copy: `Σ sale_line.total = sale.total`, `Σ sale_tender − change = total`, and
  the copy's total equals the till's stored `total_minor` to the pesewa;
- a conflict resolution: the conflict row changes and **every** sale/refund/shift/movement
  row is unchanged, proven by comparing a checksum before and after;
- a stock report: the total equals `Σ quantity_on_hand × avg_cost_minor` for the same
  filter, and the manager's figure equals the admin's figure for that one branch;
- an ageing report: bucket totals equal the sum of the row buckets, and each row equals the
  owning service's own figure (`/api/credit/aging`, `/api/payables/aging`);
- a supplier transfer: `transfer.amount = payment.amountMinor`, `Σ allocation ≤ amount`,
  the remainder is on account, and a webhook replay inserts one event and posts nothing
  twice;
- an E-VAT submission: the certificate fields are GRA's own bytes, the sale is unchanged,
  and an `E700` retry adopts the existing certificate instead of creating a second.

A test that asserts a response shape proves nothing about a drawer or a balance.

## Inherited work this phase takes or refuses

**Taken:**

- The printed Z's DRAWER block does not itemise cash refunds, and `shift_report` has no
  column to itemise them from (Plans 02, 03, 12).
- The till's `NOT_OWNER` close: a manager cannot close a cashier's drawer (Plan 12).
- `REFUND_SALE_FOREIGN` gets the API test Phase 13 owed it (Plan 03).

**Refused, with a reason, and carried to Phase 15:**

- Approval expiry (needs a policy decision: expire versus auto-reject, and what happens to
  a refund already given offline).
- The scripted held-cart restart proof.
- An electronic refund settled end to end against a live provider.
- Physical QR printing on the receipt — nothing can produce a payload at print time until
  GRA onboarding (P14-D39).
- The two demo price overrides (`GIK-00004 → 121 500`, `GIK-00006 → 41 625`) are seed
  hygiene, not this phase's story; they are recorded here so the next seed pass finds them.
