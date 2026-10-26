# Phase 12 — Branch Operations & Approval Workflow

Thirteen plans. Plans are prompts: execute one at a time, commit atomically, verify before moving
on. `00-CONTEXT.md` is the locked context; `00-DECISIONS.md` refines it and **wins where the two
disagree**. `01-RESEARCH.md` is the source list — read it once, do not repeat it.

| Plan | Title | Lane | Depends on |
|---|---|---|---|
| 01 | Shared vocabulary: approval permissions, authority, band and count arithmetic | shared | — |
| 02 | Schema, enum migrations, settings, document kind, seeds | api | 01 |
| 03 | Approvals core: per-row authority, subject registry, inbox and summary | api | 02 |
| 04 | Transfer requests: request, decide, dispatch guard, withdraw | api | 03 |
| 05 | Stock write-offs: document, approval, posted `WRITE_OFF` movement | api | 03 |
| 06 | Price band and price-change requests | api | 03 |
| 07 | Credit limit change requests and the over-limit list | api | 03 |
| 08 | Shift variance review | api | 03 |
| 09 | Cycle counts: schedules, ABC, trigger counts, accuracy | api | 03, 04, 05 |
| 10 | The operations summary read model | api | 03, 04, 05, 07, 08, 09 |
| 11 | Console: unified approval inbox and the manager's operations view | admin | 10 |
| 12 | Console: request screens for transfers, write-offs, price and credit | admin | 11 |
| 13 | Verification, evidence, state update | verification | 12 |

## Why this order

- **01 is alone and first.** `packages/shared` is imported by both clients and the API; a lane
  writing into it while another builds against it is the collision this repository does not
  survive. Plan 01 removes `procurement.approve` and adds `approval.*`, so every later plan must
  be written against the new names.
- **02 before everything in the API.** No service can be written against a table that does not
  exist, and the enum additions must land in their own migration file before any DDL or default
  uses them (P12-D9, P12-D15).
- **03 before 04–10.** Every one of those plans creates approvals and needs the authority check,
  the subject registry and the inbox contract. Building a request type first would mean writing
  the authority rule five times and deleting four.
- **04–09 are independent of each other**, except that 09 calls the stock and sales reads 04 and 05
  introduce and 10 composes all of them. They share only `approvals` (read-only after 03) and
  `packages/shared`. Each owns different files; the order is for review, not for dependency.
  They are executed **serially** anyway because they are one lane (see below).
- **10 is the last API plan** because it reads every queue the six before it created.
- **11 and 12 are last and serial.** The console consumes every endpoint above. Building a screen
  against an unfinished API is how a phase doubles.
- **13 runs when every lane is idle.** No repository-wide gate and no browser suite while a lane
  is writing.

## Execution shape — what may run in parallel

This phase is **serial by rule, not by convenience**. Plans 02–09 all write `api/**`; plans 10 and
11 both write `admin/**`; `AGENTS.md` allows one writer per lane.

| Wave | Work | Lanes | Why it is safe |
|---|---|---|---|
| 1 | **01 alone** | shared | `packages/**` is imported by both clients; it goes first and alone |
| 2 | **02 alone** | api | creates every enum, table, setting and sequence the rest reads |
| 3 | **03 alone** | api | the authority check and registries every request type consumes |
| 4 | 04 → 05 → 06 → 07 → 08 → 09 | api | disjoint file sets, but one lane: run them in order, one commit series each |
| 5 | **10 alone** | api | composes every queue above |
| 6 | 11 → 12 | admin | one module tree, one sidebar file, one gate list |
| 7 | 13 | verification | read-only; needs the stack up and every lane idle |

**Nothing in wave 4 needs a worktree.** The six plans touch six different module trees, and the
only shared file is `pos.service.ts` (08, 09, 10). If the operator wants parallelism anyway, the
only safe pair is **06 ∥ 07** (`products/**` versus `credit/**`); 08, 09 and 10 all touch
`pos.service.ts` and must not run together.

**Never while a lane is writing:** `bun run modules:check:strict`, `bun run test`, or any browser
suite. Wave 7 is the only place the repository-wide gates run.

## Lane ownership

| Lane | Owns | Plans |
|---|---|---|
| shared | `packages/**` | 01 |
| api | `api/**` (including `api/migrations`, `api/src/seed`, `api/src/app.ts`, `api/src/jobs/**`) | 02–10 |
| admin | `admin/**` | 11–12 |
| controller | root `package.json`, `scripts/**`, `biome.json`, `.github/**`, `.planning/**`, `AGENTS.md` | the `check-modules.mjs` line (11), 13 |
| verification | nothing — runs gates, read-only | 13 |

## Frozen file set

Read by every plan, written by exactly one:

| File | Owner | Plan |
|---|---|---|
| `packages/shared/src/permissions.ts`, `approvals.ts`, `pricing.ts`, `counting.ts` | shared | 01 only |
| `api/src/modules/approvals/*` | api | 03 (then read-only; 04–08 only register handlers and loaders) |
| `api/src/modules/platform/settings.validation.ts` | api | 02 only |
| `api/src/modules/platform/sequences.service.ts` | api | 02 only (adds `stock_write_off`) |
| `api/src/jobs/queues.ts` | api | 09 only |
| `api/src/app.ts` | api | 03 (approval routes + boot lists), 04–08 (each adds its own type to both boot lists), 05 (write-offs router), 10 (operations router) — one lane, in that order |
| `api/src/modules/inventory/inventory.service.ts` | api | 05 only (the shrinkage guard) |
| `api/src/modules/pos/pos.service.ts` | api | 08 (close raises the review), 09 (sold-value read), 10 (review count) — **serially** |
| `api/src/modules/products/products.service.ts` | api | 06 only |
| `api/src/modules/credit/credit.service.ts` | api | 07 only |
| `api/src/modules/counts/counts.service.ts` | api | 09 only |
| `admin/src/components/layout/sidebar.tsx` | admin | 11 only |
| `scripts/check-modules.mjs` | controller | 11 (`approvals`, `operations`) |

`api/src/app.ts` is edited by the plan that first needs it and never ahead of it: Plan 03 mounts the
approval routes and asserts the two Phase 11 types, Plans 04–08 each add their own type to both
assertion lists in the same commit as their handler and loader, Plan 05 mounts the write-offs
router, Plan 10 mounts the operations router. One lane, seven additive edits, in that order.

## The one thing this phase must not do

**Touch the POS.** No `desktop/**` change, no `powersync/sync-config.yaml` change, no local schema
change, no outbox change. The `shift` table is not synced, so even the review columns are
server-only. Plan 13 proves it with `git diff --stat` over `desktop/` and `powersync/`, both
empty, and the desktop suite unchanged at **421**.

## Verification philosophy

Every number in this phase must reconcile, so every plan's "Verification" section names the
reconciliation, not the feature:

- a write-off: Σ `stock_movement` = `stock_level.quantity_on_hand`, and the posted value equals the
  approved value to the pesewa;
- a transfer request: dispatch before approval is refused and moves nothing; after approval the
  source level drops by exactly the dispatched quantity;
- a price change: the price row equals the proposed price **once**, and a second decision is a 409;
- a credit limit: the profile equals the proposed limit only after approval, and the ledger is
  untouched either way;
- a shift review: the money columns are byte-identical before and after the decision;
- a count: accuracy is matched lines over counted lines, and the variance value equals the
  `COUNT_VARIANCE` movements the count posted.

A test that asserts a response shape proves nothing about a branch.
