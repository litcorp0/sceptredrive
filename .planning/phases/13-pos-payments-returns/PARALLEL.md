# Phase 13 — Parallel execution map

How to run these thirteen plans with subagents without two writers touching one file. The rule is
**disjoint write sets**, not "different plans": two plans that edit the same file are one lane task no
matter how unrelated they look.

Read with `README.md` ("Execution shape") and `AGENTS.md` ("Parallel builds").

---

## 1. The shape

| Lane | Subagent | Owns |
|---|---|---|
| shared | `shared-lane` | `packages/**` |
| api | `api-lane` | `api/**` |
| desktop | `pos-lane` | `desktop/**` |
| admin | `admin-lane` | `admin/**` |
| verifier | `verify` | nothing — gates, read-only |
| reviewer | `review` | nothing — diffs, read-only |
| controller | you | root files, `.planning/**`, git |

**Nine waves, not thirteen.** Wall-clock is dominated by the API chain
(`02 → 03 → 04 → 05 → 06`); the desktop chain (`08 → 09 → 10 → 11`) hides inside it. The API chain is
the floor: plans 04–07 all edit `pos.service.ts`, so they are serial by file, not by preference.

---

## 2. The schedule

| Wave | Dispatch in parallel | Lanes | Why this is safe |
|---|---|---|---|
| **1** | `01` | shared | `packages/**` is imported by both clients and the API. Alone, first, always. |
| **2** | `02` ∥ `08` | api, pos | `api/**` vs `desktop/**`. Both depend only on 01. No shared file. |
| **3** | `03` | api | Desktop is blocked: 09 needs 03's payment endpoints. |
| **4** | `04` ∥ `09` | api, pos | Disjoint trees; 09 needs 08 (done) and 03 (done). |
| **5** | `05` | api | Desktop is blocked: 10 needs 05's refund wire. |
| **6** | `06` ∥ `12` | api, admin | `api/**` vs `admin/**`; 12 needs the `refund` subject from 05 (done). |
| **7** | `07` ∥ `10` | api, pos | Disjoint trees; 10 needs 05 + 06 (done). |
| **8** | `11` | pos | Needs 10's local tables and receipt contract. |
| **9** | `13` | verify + review | Every lane idle. This is the **only** wave that runs repository-wide gates. |

Two optional fillers if you want the desktop lane busy earlier (both are plan surgery, not
recommended for the first run):

- `11` is two halves: **held carts + cart-void dialog** have no API dependency and could run in wave 5
  beside `05`; only the shift-close/Z-report half needs `06`.
- `12` needs no API call to be *written* (it renders a typed subject), only to be *tested*. It could
  run in wave 3 beside `03`, but its walkthrough would wait for 05.

---

## 3. Write sets — the table that prevents havoc

A lane may edit **only** the paths in its column. Anything else is a `NEEDS_LANE_CHANGE` report to the
controller.

| Plan | May write | Must not touch |
|---|---|---|
| 01 | `packages/shared/src/{tender,refund,cart-void,hold}.ts` (new), `permissions.ts`, `index.ts`, their `*.test.ts` | `pos.ts`, `money.ts`, any `api/**`, `desktop/**`, `admin/**` |
| 02 | `api/src/modules/pos/pos.schema.ts`, `pos.types.ts`; `api/src/modules/payments/payments.schema.ts` (new); `api/src/modules/inventory/inventory.schema.ts` (enum values only); `api/src/modules/platform/settings.validation.ts`; `api/src/config/env.ts`; `api/src/jobs/queues.ts` (**constants only**); `api/migrations/**`; `.env.example` | every `*.service.ts`, `app.ts`, any client |
| 03 | `api/src/modules/payments/**` (new files); `api/src/app.ts` (**mount only**) | `pos/**`, `sync/**`, `approvals/**`, any client |
| 04 | `api/src/modules/pos/pos.service.ts`; `api/src/modules/sync/sync.validation.ts`, `sync.types.ts`; `pos.test.ts`, `pos.tender.test.ts` | `pos.repository.ts`, `app.ts`, `approvals/**` |
| 05 | `pos.service.ts`, `pos.repository.ts`; `sync/{types,validation,service}.ts`; `approvals/{types,service}.ts`; `payments/payments.service.ts`; `app.ts` (**boot lists only**); `jobs/queues.ts` (**worker only**) | `pos.schema.ts`, migrations, any client |
| 06 | `pos.service.ts`; `sync/{types,validation,service}.ts`; `credit/credit.service.ts`, `credit/credit.schema.ts`; **one** new migration + `meta/`; tests | `app.ts`, `approvals/**`, `pos.repository.ts` |
| 07 | `pos.service.ts`, `pos.repository.ts`; `sync/sync.routes.ts`, `sync.controller.ts`; `jobs/queues.ts`; `pos.report.test.ts` | `app.ts`, `sync.service.ts`, migrations |
| 08 | `desktop/src/renderer/lib/powersync/{schema,schema-migration}.ts`; `lib/outbox/{outbox-types,outbox-repository}.ts`; `lib/api/types.ts`; `lib/sale/{sale-draft,complete-sale,sale-repository}.ts`; `lib/shift/shift-repository.ts`; `lib/receipt/render.ts`; `lib/printing/print-sale.ts`; `modules/tender/**`, `modules/receipt/**` | `src/main/**`, `routes/**`, `packages/**` |
| 09 | `src/main/payments/**` (new), `src/main/ipc/**`, `src/shared/**`, `src/preload/**`; `lib/api/payments-client.ts` (new); `modules/tender/**`, `modules/home/**` | `lib/sale/**`, `lib/powersync/schema.ts`, `routes/**` |
| 10 | `lib/refund/**` (new), `lib/overrides/override-service.ts`, `lib/receipt/render.ts`, `lib/printing/print-sale.ts`; `modules/refund/**`, `modules/repayment/**`, `modules/home/**`, `routes/**` | `lib/hold/**`, `src/main/**`, `modules/shift/**` |
| 11 | `lib/hold/**` (new), `lib/cart/void-service.ts`; `lib/receipt/report-render.ts`; `modules/sell/**`, `modules/shift/**`, `routes/**`; `src/main/printing/escpos.ts`, `src/main/ipc/printer.ts` | `lib/refund/**`, `modules/tender/**` |
| 12 | `admin/src/modules/approvals/**` | everything else |
| 13 | `.planning/phases/13-…/evidence/**`, `13-VERIFICATION.md`, `STATE.md` | application code |

**Root files belong to the controller, always:** `package.json`, `bun.lock`, `biome.json`,
`compose.yaml`, `.github/**`, `.planning/**`, `AGENTS.md`, `REQUIREMENTS.md`, `powersync/**`.

---

## 4. The collisions, named

These are why the waves above are shaped as they are. Every row is a file two plans edit.

| File | Plans | Consequence |
|---|---|---|
| `api/src/modules/pos/pos.service.ts` | 04, 05, 06, 07 | strictly serial |
| `api/src/modules/sync/sync.service.ts` | 04, 05, 06 | strictly serial |
| `api/src/modules/sync/sync.validation.ts`, `sync.types.ts` | 04, 05, 06 | strictly serial |
| `api/src/modules/pos/pos.repository.ts` | 05, 07 | serial |
| `api/src/modules/payments/payments.service.ts` | 03, 05 | serial |
| `api/src/app.ts` | 03, 05 | serial **and** controller-serialised |
| `api/src/jobs/queues.ts` | 02, 05, 07 | serial |
| `api/migrations/meta/_journal.json` | 02, 06 | never two migration writers concurrently |
| `desktop/src/renderer/modules/tender/**` | 08, 09 | serial |
| `desktop/src/renderer/lib/receipt/render.ts`, `lib/printing/print-sale.ts` | 08, 10 | serial |
| `desktop/src/renderer/modules/home/**` | 09, 10 | serial |
| `desktop/src/renderer/routes/**` | 10, 11 | serial |

If you ever want an **intra-lane** pair (two `api-lane` agents in one wave — the Phase 12 deviation),
it needs all of:

1. a row in §3 showing the two write sets do not intersect;
2. **a separate test database per agent** — `TEST_DATABASE_URL=…/sceptre_drive_test_a` and `…_b`,
   created with `bun run db:test:prepare` against each. The API suite runs `fileParallelism: false`
   because every suite shares one database; two agents on one database produce flaky failures and
   orphan rows that break `identity/staff.test.ts`;
3. the controller owns any shared file the pair would both need (`app.ts`, `queues.ts`, `_journal.json`).

The recommended schedule needs none of that: it never runs two `api-lane` agents at once.

---

## 5. Guardrails for every dispatch

- **One working tree.** Do not use worktrees: a fresh worktree has no `node_modules`, so the lane
  cannot run its own tests (Phase 12 finding). Disjoint directories in one tree is the supported shape.
- **Lanes do not touch git.** Three agents sharing one index produce mixed commits. The controller
  stages by path and commits per plan after the wave.
- **Lanes run their own narrow suite only.** `bun run --filter api test` / `--filter desktop test` /
  `--filter @sceptre/shared test`. Never `bun run test`, `modules:check:strict`, `brand:check`, or any
  Playwright script while another lane is writing — those are wave 9.
- **One API on :4000 at a time.** `test:counter`, `test:e2e`, `test:print` and the API dev server all
  claim it. Never dispatch two.
- **Plans 09–11 must not run two Electron suites concurrently** — each needs its own `userData`
  directory and the same port.
- **Report, don't reach.** If a plan needs a line outside its column, the lane stops with
  `NEEDS_LANE_CHANGE: <path> — <why>`. The controller edits it serially and tells the lane to continue.
- **Review each wave before the next.** Dispatch `review` on the wave's diff while the next wave's
  lanes start only after it reports.
- `experimental.subagent_depth` is `2`, so a lane may dispatch `verify` or `review` on its own change.

---

## 6. Dispatch prompt skeleton

Copy this into each lane, filling the four slots. The write-set list is what keeps the tree clean.

```text
You are the <lane> lane for Phase 13, plan <NN> — <title>.

Read first, in this order:
  .planning/phases/13-pos-payments-returns/00-DECISIONS.md   (P13-D<x>…D<y>)
  .planning/phases/13-pos-payments-returns/01-RESEARCH.md    (§<n>)
  .planning/phases/13-pos-payments-returns/<NN>-PLAN.md      (the tasks, tests, gates)
  <the specific source files the plan's "Read first" names>

You may WRITE only:
  <the exact paths from §3 of PARALLEL.md>

Do not touch anything else — not the root package.json, not .planning/**, not another module,
not another client. If the plan seems to need a file outside this list, stop and reply:
NEEDS_LANE_CHANGE: <path> — <why>.

Do not run git add, git commit, git checkout or git stash. The controller commits.

Implement the plan's Tasks in order, then its Tests, then run exactly:
  <the plan's Verification block>

Reply with: what changed (file → one line), the test counts before/after, the gate output,
and any NEEDS_LANE_CHANGE items. Do not summarise the plan back.
```

---

## 7. Controller checklist per wave

1. Confirm the previous wave is committed and the tree is clean for the paths about to be written.
2. Dispatch the wave's lanes (2 at most in the recommended schedule).
3. On each completion: `git add <plan's write set>` — by path, never `git add -A` — and commit with the
   plan's commit list (one commit per listed item where the diff allows it; one commit plus a body
   enumerating the rest where it does not, which is the Phase 11/12 precedent).
4. Dispatch `review` on the wave's diff; fix or defer with a written reason.
5. Only in wave 9: `bun run test`, `bun run lint`, `bun run check-types`, `modules:check:strict`,
   `brand:check`, and the Electron suites — one at a time.

---

## 8. What "done" looks like at each wave

| Wave | Green means |
|---|---|
| 1 | shared suite green, `check-types` 6/6, no API/desktop file touched |
| 2 | migrations apply from zero; desktop suite green with the new local tables; the schema-migration proof passes |
| 3 | the mock provider creates, settles and rejects a payment; webhook replay is a no-op |
| 4 | a three-tender sale applies; the credit ledger holds exactly the credit portion |
| 5 | refund caps hold per line and per tender; `REFUND` is in both boot lists |
| 6 | a cash repayment reduces the balance offline; a void is reason-coded |
| 7 | every Z figure equals a hand recomputation; an X-report writes nothing |
| 8 | a cashier sells with a split tender offline and the receipt prints both |
| 9 | a MoMo tender becomes money only after the server says so; the checkout window is locked down |
| 10 | an offline cash refund prints and uploads on reconnect |
| 11 | ten carts survive a restart; the Z-report prints |
| 12 | the refund approval is legible and changes no money |
| 13 | `ALL SUITES PASSED`, every mutation caught, `powersync/` unchanged |
