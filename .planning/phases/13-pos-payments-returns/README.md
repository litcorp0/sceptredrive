# Phase 13 — POS Payments, Returns & Shifts

Thirteen plans. Plans are prompts: execute one at a time, commit atomically, verify before moving on.
`00-CONTEXT.md` is the locked context; `00-DECISIONS.md` refines it and **wins where the two
disagree**. `01-RESEARCH.md` is the source list and the verified repository facts — read it once, do
not repeat it.

| Plan | Title | Lane | Depends on |
|---|---|---|---|
| 01 | Shared vocabulary: tender, refund and hold arithmetic, reasons, permission | shared | — |
| 02 | Schema, enum migrations, payment and refund tables, settings, sequences | api | 01 |
| 03 | Payments: provider interface, Paystack, mock, intents, webhook, verify | api | 02 |
| 04 | Sale completion: multi-tender, credit split, payment linkage | api | 03 |
| 05 | Refunds: document, caps, restock, credit reduction, retrospective approval | api | 04 |
| 06 | Credit repayment and cart void: two new device-originated facts | api | 05 |
| 07 | X/Z reports, the shift snapshot and the nightly payment sweep | api | 04 |
| 08 | Tender engine and the split-tender screen (desktop) | desktop | 04 |
| 09 | Electronic tenders at the till: MoMo, bank transfer, card, recovery | desktop | 08 |
| 10 | Refunds and credit repayment at the till | desktop | 09 |
| 11 | Held carts, cart void, shift close and the Z-report | desktop | 10 |
| 12 | Console: the refund approval detail | admin | 05 |
| 13 | Verification, evidence, state update | verification | 12 |

## Why this order

- **01 is alone and first.** `packages/shared` is imported by both clients and the API. Plan 01
  introduces `tender.ts`, `refund.ts`, `cart-void.ts`, `hold.ts`, one permission and the market
  labels every later plan imports. A lane writing into `packages/` while another builds against it
  is the collision this repository does not survive.
- **02 before every API plan.** No service can be written against a table that does not exist, and
  five enum additions must land in their own migration file before any DDL or default uses them
  (P13-D38). The new `payment`, `refund` and `shift_report` tables are read by 03–07 and by 08–11
  only through HTTP.
- **03 before 04.** A sale tender may only reference a `PAID` payment, so the payment entity and its
  provider flows must exist before the sale can accept an electronic tender. Building the sale first
  would mean writing the payment assertion twice.
- **04 before 05, 06 and 07.** Refunds reference `sale_tender` per tender; a repayment is a
  credit-ledger fact; the Z-report sums `refund` and `cart_void`. All three need a sale that can be
  split.
- **05 before 06** only for the refundable-remainder lock, which 06 reuses for the repayment's
  idempotency pattern. They are otherwise independent and both are one lane, so the order is for
  review.
- **07 after 04** because `shift_report` is written by `closeShift`, which 04 rewrites the tender
  side of. It is deliberately not after 05/06 so a reviewer can read the report arithmetic against a
  sale-only ledger first; it composes refunds and voids when they exist, with a `0` where a document
  does not.
- **08–11 are serial.** They are one lane and they share `tender-page.tsx`, `complete-sale.ts`,
  `sale-draft.ts`, the local schema and the receipt renderer. 09 depends on 08's tender builder,
  10 on 09's payment client, 11 on 10's local schema additions being settled.
- **12 is last among implementers.** The console renders an approval subject that 05 registers.
- **13 runs when every lane is idle.** No repository-wide gate and no browser suite while a lane is
  writing.

## Execution shape — what may run in parallel

This phase is **serial by lane, parallel by wave**. Plans 02–07 all write `api/**`; 08–11 all write
`desktop/**`; 12 writes `admin/**`.

| Wave | Work | Lanes | Why it is safe |
|---|---|---|---|
| 1 | **01 alone** | shared | `packages/**` is imported by both clients; it goes first and alone |
| 2 | **02 alone** | api | creates every enum, table, setting and sequence the rest reads |
| 3 | **03 alone** | api | the payment entity every electronic tender references |
| 4 | 04 → 05 → 06 → 07 | api | one lane; disjoint module trees except `pos.service.ts` (04, 05, 07) and `sync.service.ts` (04–07) |
| 5 | 08 → 09 → 10 → 11 | desktop | one lane, one module tree, one local schema |
| 6 | **12** | admin | consumes the `refund` subject registered in 05 |
| 7 | **13** | verification | read-only; needs the stack up and every lane idle |

**The desktop lane may start 08 as soon as 04 is green.** 08's arithmetic lives in
`packages/shared` (from 01) and its server contract is the `SALE` upload from 04; it does not read
03's payment endpoints until 09. That is the only cross-lane overlap this phase permits, and only
because the two lanes touch disjoint trees.

**Nothing in wave 4 needs a worktree.** Four plans touch two shared files (`sync.service.ts`,
`pos.service.ts`) and must be executed in the listed order regardless. If 05 ∥ 06 is attempted, they
collide on `sync.service.ts`'s `dispatchTransaction` and `pos.service.ts`'s imports — do not.

**Never while a lane is writing:** `bun run modules:check:strict`, `bun run test`, `bun run
brand:check`, or any Playwright suite. Wave 7 is the only place the repository-wide gates run.

## Lane ownership

| Lane | Owns | Plans |
|---|---|---|
| shared | `packages/**` | 01 |
| api | `api/**` (including `api/migrations`, `api/src/seed`, `api/src/app.ts`, `api/src/jobs/**`, `api/src/config/env.ts`) | 02–07 |
| desktop | `desktop/**` (including `src/main/**`, the local schema, the outbox and the receipt) | 08–11 |
| admin | `admin/**` | 12 |
| controller | root `package.json`, `scripts/**`, `biome.json`, `.github/**`, `.planning/**`, `AGENTS.md`, `REQUIREMENTS.md`, `powersync/**` | 01's requirement correction, 13 |
| verification | nothing — runs gates, read-only | 13 |

## Frozen file set

Read by every plan, written by exactly one:

| File | Owner | Plan |
|---|---|---|
| `packages/shared/src/tender.ts`, `refund.ts`, `cart-void.ts`, `hold.ts` | shared | 01 only |
| `packages/shared/src/permissions.ts`, `approvals.ts` | shared | 01 only |
| `api/src/modules/platform/settings.validation.ts` | api | 02 only |
| `api/src/modules/pos/pos.schema.ts` | api | 02 only (then read; 04/05/07 write services, not tables) |
| `api/src/modules/payments/*` | api | 03 only |
| `api/src/modules/sync/sync.types.ts`, `sync.validation.ts` | api | 02 (union + schemas), then read |
| `api/src/modules/sync/sync.service.ts` | api | 04 (`SALE`), 05 (`REFUND`), 06 (`CREDIT_REPAYMENT`, `CART_VOID`) — **serially** |
| `api/src/modules/pos/pos.service.ts` | api | 04 (sale), 05 (refund), 06 (void/repayment read?), 07 (close/report) — **serially** |
| `api/src/modules/pos/pos.repository.ts` | api | 04, 05, 07 — serially |
| `api/src/modules/credit/credit.service.ts` | api | 06 only (nothing: the repayment reuses `postEntryInTransaction` unchanged) |
| `api/src/jobs/queues.ts` | api | 02 (queue names), 05 (refund worker), 07 (reconcile worker) |
| `api/src/app.ts` | api | 03 (payments router + webhook), 05 (`REFUND` in both boot lists) |
| `api/src/config/env.ts` | api | 02 only (`PAYSTACK_*`) |
| `desktop/src/renderer/lib/powersync/schema.ts` | desktop | 08 only (all local tables land at once) |
| `desktop/src/renderer/lib/powersync/schema-migration.ts` | desktop | 08 only (proof re-run) |
| `desktop/src/renderer/lib/outbox/outbox-types.ts`, `api/types.ts`, `shift-repository.ts` | desktop | 08 (union), then read |
| `desktop/src/renderer/modules/tender/**` | desktop | 08 (builder), 09 (electronic), 10 (refund entry), 11 (hold entry) — serially |
| `desktop/src/renderer/lib/receipt/render.ts` | desktop | 08 (tenders[]), 10 (refund block), 11 (report) — serially |
| `admin/src/modules/approvals/**` | admin | 12 only |

`api/src/app.ts` is edited twice and never ahead of what it mounts: Plan 03 mounts the payments
router and the webhook (the only unauthenticated mutating route in the API), Plan 05 appends
`REFUND` to both registry boot lists in the same commit as its handler and loader.

## The three things this phase must not do

1. **Never block a sale on the network.** A cash sale, a cash refund, a cash repayment, a void, a
   hold, a recall and a shift close all work with the cable unplugged. The only paths that need
   connectivity are MoMo, card, bank transfer, an electronic refund and a `PENDING` verification.
2. **Never let the client assert money.** A tender is money only when the server's `payment` says
   `PAID` (electronic) or the drawer took it (cash/credit). The till renders what the server and its
   own rows say, and a client "success" callback is ignored by design.
3. **Never rewrite a sale.** A refund is a new document, a void is a new document, and the sale's
   money columns are byte-identical after both.

## Verification philosophy

Every number in this phase must reconcile, so every plan's "Verification" section names the
reconciliation, not the feature:

- a split sale: `Σ sale_tender.amount − change_minor = total_minor`, and the credit ledger received
  exactly the credit tender;
- an electronic tender: `payment.PAID` exists, is referenced once, and its amount equals the tender;
- a refund: the sale is unchanged, `Σ refund_tender ≤ Σ sale_tender − change`, and a `RESALABLE`
  line moved stock by `+quantity` while `DAMAGED` moved nothing;
- a repayment: the ledger balance moved by exactly `−amount`;
- a Z-report: every figure equals a recomputation from the shift's own rows;
- a webhook replay: 200, and not one row changed.

A test that asserts a response shape proves nothing about a drawer.
