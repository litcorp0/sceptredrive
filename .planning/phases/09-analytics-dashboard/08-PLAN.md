---
phase: 09-analytics-dashboard
plan: 08
title: Verification, evidence, and state update
lane: verification (read-only over code, writes .planning only)
depends_on: [05, 07]
requirements: [ADM-02, RPT-01, RPT-02, RPT-03, ANL-01, ANL-02, ANL-03]
---

# Plan 08 — Verification

## Goal

Prove the phase goal, not the task list: every dashboard figure reconciles to a ledger, a
manager cannot reach another branch's numbers, every chart is readable without a hover and in
both themes at 320 px, and a copied URL reproduces the exact view.

## Read first

- `.planning/phases/07-identity-design-system/01-VERIFICATION.md` — the goal-backward format
  to copy.
- `.planning/phases/08-admin-modules-shell/01-VERIFICATION.md` and `evidence/suites.txt`.
- `admin/test/walkthrough-sections.mjs:133-228,331-429` — sections, assertion helper,
  manager leg, console hygiene.
- `scripts/check-tokens.mjs`, `scripts/check-modules.mjs`, `scripts/check-brand.mjs`.
- `STATE.md:389-395` — run the API suite without parallel browser runs; a concurrent suite
  produced a false 5 s timeout once.

## Tasks

### 1. Walkthrough updates (`admin/test/walkthrough-sections.mjs`)

- `SECTIONS[0]` → `["/", "Today at"]` (the new heading), keeping the screenshot.
- Add `["/analytics", "Sales"]` and a deep link
  `["/analytics?tab=tax&granularity=month&from=<30d>&to=<today>", "Tax"]`.
- Add each tab to the section list (`products`, `inventory`, `credit`, `loyalty`, `payables`)
  with a stable heading from the tab component, not from a number.
- New leg **chart readability**: at `/analytics?tab=sales`, assert
  - every chart is inside a `<figure>` with a `<figcaption>`,
  - each chart container has `role="img"` and a non-empty `aria-label`,
  - a `<details>` exists per chart and expands to a `<table>` with a `<caption>`,
  - axis labels exist (`svg text` count > 0 per chart).
- New leg **CSV**: `page.waitForEvent("download")` on the Tax export, then read the file and
  assert it starts with `\uFEFF`, contains `vat_minor`, ends each line with `\r\n`, and has
  more than one row. Delete the temp file.
- New leg **manager**: add `/analytics` and `/analytics?tab=payables` to the manager loop;
  assert no branch select, no branch ranking card, and that appending a foreign `branchId`
  leaves the rendered take unchanged (mirroring the existing adversarial step at lines
  397-410).
- Keep the console/network hygiene rule: no new tolerated 4xx; `/api/analytics/*` must never
  403 or 500 during the walkthrough.

### 2. Browser evidence (`admin/test/capture-analytics.mjs`)

Model it on `evidence/capture-shell.mjs` and the Phase 7 chart proofs. Matrix:
**320, 768, 1024, 1440 px × light × dark × reduced motion**, over `/` and
`/analytics?tab=sales|products|tax`.

Assertions per cell:

- no horizontal scroll (`documentElement.scrollWidth <= innerWidth`), including charts
  (the Phase 7 `min-w-0` bug);
- no zero-height chart;
- first series stroke/fill is `var(--chart-1)` resolved to `rgb(242, 106, 27)`;
- with `prefers-reduced-motion: reduce`, no transition or animation exceeds 1 ms (parse the
  computed duration; Chrome serialises `1e-05s`);
- keyboard: park the pointer **off** the chart (recharts#7905), `Tab` to the chart, press
  `ArrowRight`, assert the tooltip content changes — this is the proof that the Recharts 3
  accessibility layer is live;
- contrast: compute the rendered colours of each series against the panel background and
  assert ≥ 3:1; assert `--chart-6`/`--chart-7` resolve and differ from the first five;
- no off-machine request.

Write `evidence/shots/plan09-{admin,analytics}-{width}-{theme}.png` (24+ files) and a JSON
summary. Target ~150 assertions; record the exact number in the verification document.

### 3. Performance evidence (`evidence/verify-analytics-perf.mjs`)

Against the seeded demo month (Plan 05), call each of the eight endpoints 10 times with a
real session and report p50/p95/max per endpoint.

- Budget: **p95 ≤ 300 ms** (D13) on the local Docker Postgres with the 5-branch dataset.
- Also run `EXPLAIN (ANALYZE, BUFFERS)` on the overview series and the product report and
  save the output; confirm the plan uses `sale_branch_occurred_idx` (or
  `sale_line_sale_idx`) and shows no sequential scan over `sale_line` at demo scale.
- This is evidence, not a CI gate (timings are machine-dependent); a regression is a finding
  in the verification document.

### 4. Full gate matrix (`evidence/suites.txt`)

Run, in this order, with no browser suite running concurrently with `bun run test`:

```bash
bun run lint
bun run check-types
bun run brand:check
bun run tokens:check
bun run modules:check:strict
bun run test                     # NOT `bun test`
bun run --filter admin build
bun run --filter desktop build   # npm_config_user_agent workaround from STATE.md if needed
bun run --filter admin test:walkthrough
node admin/test/capture-analytics.mjs
```

Expected floors: API ≥ 372, shared ≥ 120, desktop 339 unchanged, admin walkthrough ≥ 60
sections with zero failures, modules gate strict green, token gate green over seven chart
tokens. Any suite that changes a previous number must say why in the transcript.

### 5. Goal-backward verification document

`.planning/phases/09-analytics-dashboard/01-VERIFICATION.md`, one row per roadmap success
criterion (six) and per requirement (`ADM-02`, `RPT-01…03`, `ANL-01…03`), each naming a
command or a recorded manual step:

1. Every dashboard/analytics figure comes from a server aggregate — cite the API tests and
   the `sum(sale.total_minor)` cross-check.
2. Manager branch scoping cannot be bypassed by a query parameter — cite the 403 test and
   the walkthrough's adversarial leg.
3. Period, branch, and granularity live in the URL — cite the deep-link walkthrough step and
   the screenshot.
4. Charts state their meaning without a hover — cite the figure/caption/label/table
   assertions.
5. Deltas, tender mix, top products, and tax split are integer minor units — cite the
   `percent`/`csv` unit tests and a `grep` for `parseFloat`/`toFixed` in the new module.
6. A demo seed produces a realistic month — cite the seed transcript and overview totals.

### 6. Documentation and state

- `STATE.md`: Phase 9 → complete with plan count; add an execution-notes section recording
  the four decisions (P9-D1…D4), the numbers, any deviation, and the carry-forwards.
- `ROADMAP.md`: Phase 9 status line, success criteria unchanged, and fix line 158 —
  "PowerSync Cloud (Phase 9 setup gate)" becomes a Phase 15 reference (stale numbering).
- `AGENTS.md`: change the command list from `bun test` to `bun run test` with the one-line
  reason from `STATE.md:307-309`.
- `REQUIREMENTS.md`: only if a requirement moved; otherwise record "no change".
- Append the deviation list to `00-DECISIONS.md` if execution changed a decision.

## Commits

1. `test(admin): walkthrough sections for the dashboard and analytics`
2. `test(evidence): analytics chart, CSV, and manager-boundary proof`
3. `test(evidence): analytics endpoint performance transcript`
4. `docs(planning): phase 9 verification, state, and roadmap update`

## Done when

- Every success criterion has a command or a recorded step that would fail if the criterion
  were false.
- Evidence files exist and the numbers in the verification document match them.
- `STATE.md` names the next action (Plan Phase 10) and every carry-forward is recorded.
- No test was edited to pass; any changed expectation is explained in the document.
