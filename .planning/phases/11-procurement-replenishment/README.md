# Phase 11 — Procurement, Replenishment & Supplier Returns

Eleven plans. Plans are prompts: execute one at a time, commit atomically, verify before moving
on. `00-CONTEXT.md` is the locked context; `00-DECISIONS.md` refines it and wins where the two
disagree. `01-RESEARCH.md` is the source list — read it once, do not repeat it.

| Plan | Title | Lane | Depends on |
|---|---|---|---|
| 01 | Shared vocabulary: permissions, approval types, replenishment arithmetic | shared | — |
| 02 | Schema, migration, threshold settings, document numbering, seeds | api | 01 |
| 03 | Approvals core, threshold resolution, product submission | api | 02 |
| 04 | Purchase order lifecycle | api | 03 |
| 05 | Receiving, supplier-product link, derived catalogue cost | api | 04 |
| 06 | Invoice matching against a purchase order | api | 05 |
| 07 | Purchase returns and supplier credit notes | api | 05 |
| 08 | Replenishment suggestions and supplier performance | api | 07 |
| 09 | Console: procurement module (orders, receiving, returns, submission, invoice matching) | admin | 08 |
| 10 | Console: replenishment and supplier performance | admin | 09 |
| 11 | Verification, evidence, state update | verification | 10 |

## Why this order

- **01 is alone and first.** `packages/shared` is imported by both clients and the API. A lane
  writing into it while another builds against it is the one collision this repository does not
  survive — the same rule Phase 10 applied to the day window.
- **02 before everything else in the API** because no service can be written against a table
  that does not exist, and because the numbering allocator is a dependency of four documents.
  It is also the only *planned* migration: Plan 08 adds one index only if the recorded `EXPLAIN`
  shows the velocity query needs it, and must say why.
- **03 before 04.** A purchase order's submit step *is* an approval decision. Building the order
  first would mean writing the threshold rule twice and then deleting one.
- **04 → 05 → 06.** Each consumes the previous plan's document: you cannot receive against an
  order that does not exist, and you cannot match an invoice to an order you cannot receive.
- **05 before 07.** A return is capped by what was received; the receipt line is the unit of
  return, so returns cannot be built before receiving lands.
- **07 before 08.** Replenishment reads on-order quantity, which is defined by the order and
  receipt aggregates. Supplier performance reads receipts, which 05 and 07 create.
- **09 and 10 are last and serial.** The admin console is one lane, and the screens consume
  every endpoint above. Building a screen against an unfinished API is how a phase doubles.
- **11 runs when every lane is idle.** No repository-wide gate and no browser suite while a lane
  is writing.

## Execution shape — what may run in parallel

This phase is **serial by rule, not by convenience**. Plans 02–08 all write `api/**`; plans 09
and 10 both write `admin/**`; `AGENTS.md` allows one writer per lane.

| Wave | Work | Lanes | Why it is safe |
|---|---|---|---|
| 1 | **01 alone** | shared | `packages/**` is imported by both clients; it goes first and alone |
| 2 | **02 alone** | api | creates every table, setting and sequence the rest of the phase reads |
| 3 | 03, then 04, then 05 | api | each consumes the previous plan's service; sharing `procurement.service.ts` |
| 4 | **06 ∥ 07** *(optional)* | api, split by file set | 06 owns `payables.service.ts` invoice paths + `procurement/` matching files; 07 owns `payables` balance/aging + `procurement/return` files. They **share** `payables.repository.ts` and `payables.service.ts`, so this wave is only safe under a written file split — if that split has to be renegotiated mid-flight, run them serially. The default is serial |
| 5 | **08 alone** | api | new `replenishment/` module; reads order, receipt and `sale_line` |
| 6 | 09, then 10 | admin | one module tree, one nav file |
| 7 | 11 | verification | read-only; needs the stack up and every lane idle |

**Worktrees.** Wave 4 is the only place a worktree buys anything, and merging two edits to the
same payables service is real work. The recommendation is **run 06 and 07 serially**; nothing in
either plan assumes a particular execution shape.

**Never while a lane is writing:** `bun run modules:check:strict`, `bun run test`, or any browser
suite. Wave 7 is the only place the repository-wide gates run.

## Lane ownership

| Lane | Owns | Plans |
|---|---|---|
| shared | `packages/**` | 01 |
| api | `api/**` (including `api/migrations`, `api/src/seed`, `api/src/app.ts`) | 02–08 |
| controller | root `package.json`, `scripts/**`, `biome.json`, `.github/**`, `.planning/**`, `AGENTS.md` | 09–10 (one gate line each), 11 |
| admin | `admin/**` | 09–10 |
| verification | nothing — runs gates, read-only | 11 |

`api/src/app.ts` is written by Plan 02 alone: it creates the three empty module routers and mounts
them, so no later plan edits the file. Two lanes editing the same four lines is exactly the
collision the one-writer rule exists to prevent.

The admin module gate (`scripts/check-modules.mjs`) is a controller file, edited once by Plan 09
(`procurement`) and once by Plan 10 (`replenishment`), each in the same commit that creates the
directory the gate will then require. A required-but-absent directory is a hard failure, so the
list never runs ahead of the tree.

## Frozen file set

These files are read by every plan and written by exactly one:

| File | Owner | Plan |
|---|---|---|
| `packages/shared/src/permissions.ts` | shared | 01 |
| `packages/shared/src/replenishment.ts`, `approvals.ts` | shared | 01 |
| `api/src/modules/platform/sequences.*` | api | 02 |
| `api/src/modules/platform/settings.validation.ts`, `settings.service.ts` | api | 02 only |
| `api/src/modules/platform/audit.*` | nobody — read-only | — |
| `api/src/modules/inventory/inventory.service.ts` | api | 05 only |
| `api/src/modules/payables/payables.service.ts` | api | 06 then 07, serially |
| `api/src/modules/products/products.service.ts` | api | 05 (cost guard) + 03 (submission handler) — see the note in Plan 03 |
| `admin/src/components/layout/sidebar.tsx` | admin | 09 only |
| `scripts/check-modules.mjs` | controller | 09 (`procurement`), 10 (`replenishment`) |

## The one thing this phase must not do

**Touch the POS.** No `desktop/**` change, no `powersync/sync-config.yaml` change, no outbox or
upload change, no local schema change. Procurement is admin/manager only and online-only
(`00-CONTEXT.md` D14). Plan 11 proves it with `git diff --stat` over `desktop/` and
`powersync/`, both empty, and with the desktop suite unchanged at its Phase 10 count.

## Verification philosophy

Every number in this phase must reconcile to a ledger, so every plan's "Verification" section
names the reconciliation, not the feature: ordered = received + outstanding; invoice + credit
note = supplier balance; Σ movements = on-hand; suggestion = a hand-computed arithmetic. A test
that asserts a response shape proves nothing about a purchase.
