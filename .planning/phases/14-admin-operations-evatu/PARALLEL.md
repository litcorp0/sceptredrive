# Phase 14 — Parallel execution map

This is the controller's file. `README.md` says why the order is what it is; this file says
what a lane may write, in which wave, and what it must not touch.

**Controller rule:** the controller keeps the plan, `STATE.md`, and every root file. It
never implements a lane's work. A lane that needs a root file changed reports
`NEEDS_LANE_CHANGE`; the controller edits it serially and commits.

---

## Waves

| Wave | Plans | Lanes | Gate before the wave starts |
|---|---|---|---|
| 1 | 01 | shared | nothing — it is first and alone |
| 2 | 02 | api | 01's tests green, `check-types` green |
| 3 | 03 → 04 **∥** 12 | api, desktop | 02 migrated on the test database; 03 green before 12 starts |
| 4 | 05 **∥** 11 | api, admin | 03/04 green; 02's settings exist |
| 5 | 06 **∥** 08 | api, admin | 04 green (08 reads the queue), 02 green |
| 6 | 07 **∥** 09 | api, admin | 05 green (09's exports), 02 green |
| 7 | 10 | admin | 06 and 07 green |
| 8 | 13 | verification | every lane idle |

**Lane serialisation is not optional even inside a wave.** `api` executes 03 → 04 → 05 →
06 → 07 in file order; `admin` executes 11 → 08 → 09 → 10 in file order. The wave table
says when a plan *may* start, not that two plans in one lane run together.

Two plans never run together in the same lane. The controller dispatches one at a time and
waits.

---

## Write sets

A lane writes only these paths. Anything else is a `NEEDS_LANE_CHANGE`.

### 01 — shared
`packages/shared/src/{permissions,flags,conflicts,transfers,evat}.ts`,
`permissions.test.ts`, the three new test files, `packages/shared/src/index.ts`.

### 02 — api, schema
`api/migrations/0016_enum_phase14.sql`, `api/migrations/0017_phase14_schema.sql`,
`api/src/modules/platform/settings.validation.ts`,
`api/src/modules/pos/pos.schema.ts`, `api/src/modules/payables/payables.schema.ts`,
`api/src/modules/payments/payments.schema.ts`,
`api/src/modules/suppliers/suppliers.schema.ts` (types only, no column change),
`api/src/modules/evat/evat.schema.ts` (new),
`api/src/modules/platform/phase14-schema.test.ts`, `api/src/seed/demo.ts`.

### 03 — api, oversight reads
`api/src/modules/pos/pos.oversight.repository.ts` (new),
`api/src/modules/pos/pos.oversight.service.ts` (new),
`api/src/modules/pos/pos.routes.ts`, `pos.validation.ts`, `pos.controller.ts`,
`pos.types.ts`, `pos.service.ts` (the report extraction and `cashRefundMinor` only),
`pos.repository.ts` (figures + new selectors), `pos.oversight.test.ts` (new).

### 04 — api, conflicts
`api/src/modules/pos/pos.routes.ts`, `pos.validation.ts`, `pos.controller.ts`,
`pos.service.ts` (`resolveConflict` only), `pos.repository.ts` (the write),
`pos.conflicts.test.ts` (new).

> 03 and 04 both write `pos.routes.ts`, `pos.validation.ts`, `pos.controller.ts`,
> `pos.service.ts` and `pos.repository.ts`. They are one lane and they run in this order.
> A second writer in `pos/` during wave 3 is the collision this file exists to prevent.

### 05 — api, reports
`api/src/modules/inventory/inventory.report.ts` (new), `inventory.routes.ts`,
`inventory.controller.ts`, `inventory.validation.ts`, `inventory.types.ts`,
`api/src/modules/credit/credit.{service,routes,controller,validation}.ts`,
`api/src/modules/payables/payables.{service,routes,controller}.ts` (exports only —
**no refactor of `createPayment`**, that is 06),
`api/src/modules/loyalty/loyalty.{service,routes,controller}.ts`,
`api/src/modules/platform/audit.{service,routes,controller,validation}.ts`,
`api/src/modules/transfers/transfers.validation.ts`,
`api/src/modules/counts/counts.validation.ts`,
`api/src/modules/analytics/analytics.{repository,types}.ts` (`saleId` only),
`inventory.report.test.ts` (new) plus additions to `credit.test.ts`, `payables.test.ts`,
`loyalty.test.ts`, `platform.test.ts`.

### 06 — api, supplier transfers
`api/src/modules/payments/payments.{provider,paystack.provider,mock.provider}.ts`,
`payments.service.ts`, `payments.repository.ts`, `payments.schema.ts` (type only — the
column is 02's), `payments.types.ts`,
`api/src/modules/payables/payables.{service,repository,routes,controller,validation,types}.ts`,
`api/src/modules/suppliers/suppliers.{service,repository,types}.ts` (the recipient writer
and the stale-clear), `api/src/jobs/queues.ts` (the sweep),
`payables.transfer.test.ts`, `payables.transfer.webhook.test.ts` (new).

> 06 needs **no** `app.ts` edit: the webhook is already mounted and the new event names are
> constants inside `payments.service.ts`.

### 07 — api, E-VAT
`api/src/modules/evat/**` (all of it except `evat.schema.ts`, which 02 wrote),
`api/src/config/env.ts`, `api/src/app.ts` (mount),
`api/src/jobs/queues.ts` (the submission queue),
`api/src/modules/sync/sync.service.ts` (`queueForSale` / `queueForRefund` calls inside the
transaction),
`api/src/modules/pos/pos.service.ts` (nothing expected),
`.env.example`,
`evat.test.ts` (new).

> 06 and 07 both write `app.ts` and `jobs/queues.ts`. Serial, in that order.

### 08 — admin, pos-oversight
`admin/src/modules/pos-oversight/**` (new),
`admin/src/routes/_authenticated/pos/**` (new, five thin files),
`admin/src/components/layout/sidebar.tsx`,
`admin/src/modules/dashboard/components/needs-attention.tsx`,
`admin/src/modules/analytics/pages/tabs/sales-tab.tsx` (the receipt link),
`admin/src/styles.css` (the receipt-copy print wrapper),
`admin/test/walkthrough-sections.mjs`.

### 09 — admin, exports and print
`admin/src/components/common/{export-button,print-button,print-sheet}.tsx`,
`admin/src/modules/analytics/components/export-button.tsx` (deleted; call sites updated),
`admin/src/modules/{inventory,credit,payables,loyalty,audit}/**` (export/print/filters only),
`admin/src/styles.css`, `admin/test/walkthrough-sections.mjs`.

> 09 and 10 both write `admin/src/modules/payables/**`. 09 runs first and touches only the
> aging page and the shared button; 10 adds the transfer dialog, list, detail and
> reconciliation. If the order is ever reversed, 10 waits for 09's payables commit.

### 10 — admin, transfers and E-VAT
`admin/src/modules/payables/**` (transfers, reconciliation, provider balance),
`admin/src/modules/suppliers/components/payment-details-panel.tsx`,
`admin/src/modules/evat/**` (new),
`admin/src/routes/_authenticated/suppliers/transfers/**`,
`admin/src/routes/_authenticated/suppliers/reconciliation.tsx`,
`admin/src/routes/_authenticated/evat.tsx`,
`admin/src/components/layout/sidebar.tsx`, `admin/test/walkthrough-sections.mjs`.

### 11 — admin, settings, flags, matrix
`admin/src/modules/settings/**`,
`admin/src/modules/staff/pages/permissions-page.tsx` (new) +
`admin/src/routes/_authenticated/staff/permissions.tsx` (new),
`admin/src/modules/audit/pages/audit-page.tsx`,
`admin/src/components/layout/sidebar.tsx`, `admin/test/walkthrough-sections.mjs`.

### 12 — desktop
`desktop/src/renderer/lib/receipt/report-render.ts`,
`desktop/src/renderer/lib/shift/{shift-service,shift-repository}.ts`,
`desktop/src/renderer/modules/shift/**`,
the three test files.

### 13 — verification
`verification` writes nothing outside `.planning/phases/14-admin-operations-evatu/evidence/`
and `14-VERIFICATION.md`. The `STATE.md` and `ROADMAP.md` edits are the controller's.

---

## The controller's own edits

| Edit | When | Why it is the controller's |
|---|---|---|
| `scripts/check-modules.mjs` — add `pos-oversight` | before 08's first commit | root file |
| `scripts/check-modules.mjs` — add `evat` | before 10's first commit | root file |
| `admin/src/modules/README.md` — the two new modules | with the above | documentation that the gate and the README must agree on |
| `.planning/STATE.md`, `.planning/ROADMAP.md` | wave 8 | phase memory |
| `packages/brand/**` | never | the phase has no brand work |

Both `check-modules.mjs` edits are one line in `REQUIRED_MODULES` plus, while the module is
half-built, one entry in `PENDING_MODULES`. The controller removes the `PENDING` entry in
the commit that makes the module complete — a lane cannot do either without owning a root
file.

---

## Dispatch skeleton

Every lane prompt carries the same six paragraphs, in this order:

```text
You are the <lane> lane for Phase 14, Plan <NN> — <title>.

Read, in this order: AGENTS.md; .planning/STATE.md (the Phase 14 row only);
.planning/phases/14-admin-operations-evatu/{README.md,00-DECISIONS.md,01-RESEARCH.md,
<NN>-PLAN.md}. Load the skills AGENTS.md names for this lane (owasp-security always;
supabase-postgres-best-practices for 02/05/06/07; hono for the API plans;
web-design-guidelines and frontend-design for the console plans).

Write only these paths: <the write set above>. Everything else is out of scope; if you need
a root file changed, stop and report NEEDS_LANE_CHANGE with the exact edit.

Implement the plan task by task. Commit atomically with conventional messages, one commit
per task, and do not rewrite history.

Run this narrow suite before you report: <the plan's Verification block>. A red suite is a
finding, not a reason to weaken a test.

Report: the commits, the test counts before and after, anything you found in the plan that
was wrong and what you did instead, and every path you touched outside the write set
(there must be none).
```

Lanes may dispatch `verify` or `review` on their own change (`experimental.subagent_depth`
is 2). They may not dispatch another implementer.

---

## The non-negotiables, restated for a parallel phase

- **One writer per lane.** Two implementers in `api/**` is a lost update in
  `pos.routes.ts` and a commit that is not bisectable.
- **`packages/**` first and alone.** 01 lands before anything imports a new name.
- **No repository-wide gate while a lane is writing.** `modules:check:strict`, `test`,
  `brand:check` and the Playwright suite run in wave 8.
- **No SQL fixture in an external walkthrough** unless the plan says the figure is being
  re-derived. Fixtures go through the API so the walkthrough proves the API.
- **A decision about money, credit, stock, loyalty, permissions or production still stops
  and asks.** Plan 06's no-threshold decision and Plan 07's no-GRA-client decision are the
  two places this phase deliberately chose not to invent a policy.
