---
phase: 07-identity-design-system
plan: 07
wave: 4
title: Phase verification, evidence, and state update
requirements: [UIX-01, UIX-02, UIX-03, UIX-04, UIX-05]
depends_on: [01, 02, 03, 04, 05, 06]
status: planned
created: 2026-10-24
---

# Plan 07 — Phase Verification, Evidence, and State Update

**Goal:** Prove the phase goal backwards — one identity, one token source, one primitive set,
one date formatter, nothing broken — with evidence a reviewer can re-run.

## Task 1 — Automated gates

**Files:** `scripts/check-tokens.mjs`, root `package.json`,
`.github/workflows/checks.yml`

Write `scripts/check-tokens.mjs` and wire it as `"tokens:check"`. It must exit non-zero if:

1. `admin/src/styles.css` or `desktop/src/renderer/index.css` does not import
   `@sceptre/brand/tokens.css`.
2. Either app file (or any file under `admin/src`, `desktop/src/renderer`, excluding
   `packages/brand`) contains `#f26a1b`, `#1b1f23`, `f26a1b`, or `1b1f23` — brand values come
   from the package only.
3. `packages/brand/src/tokens.css` is missing any required custom property: the full
   `--background`…`--ring` set, `--chart-1`…`--chart-5`, `--brand`, `--brand-fg`,
   `--brand-ink`, `--ink`, `--canvas`, `--surface`, `--muted-ink`, `--line`, `--topbar`,
   `--sidebar-*`, `--layout-*`, `--radius` — in **both** `:root` and `.dark` where applicable.
4. Any of these contrast pairs falls below its threshold (compute WCAG relative luminance in
   the script, do not hard-code the ratio):
   - `#1B1F23` on `#F26A1B` ≥ 4.5 (primary button label)
   - `#FFFFFF` on `#F26A1B` **must be < 4.5** — the script asserts the rejected pair stays
     rejected, so nobody "improves" the design into a failure
   - `#5C6470` on `#F6F6F4` ≥ 4.5 (muted text)
   - `#1B1F23` on `#F6F6F4` ≥ 7
   - `#C25515` on `#FFFFFF` ≥ 4.5 (brand as text)
   - `#F6F6F4` on `#22272C` ≥ 7 and `#A8B0B9` on `#22272C` ≥ 4.5 (dark mode)
5. `date-fns` resolves to more than one version in the workspace lockfile.

Add both `brand:check` and `tokens:check` to the CI checks job.

**Verify:** `bun run brand:check && bun run tokens:check` exit 0. Then break each rule in
turn (add a hex to `admin/src/styles.css`, delete a token, swap the primary foreground to
white) and confirm the script fails with a readable message each time; revert.

**Commit:** `test(brand): gate token parity, contrast, and stale brand strings`

## Task 2 — Full suite and build matrix

**Evidence:** `phases/07-identity-design-system/evidence/suites.txt`

Run and capture, in one transcript:

```bash
bun install
bun run lint
bun run check-types
bun run brand:check
bun run tokens:check
bun test                       # shared + api + desktop
bun run --filter admin build
bun run --filter desktop package
```

Expected baselines — a lower count is a regression, not a new normal:

| Suite | Baseline |
|---|---|
| API | 354 |
| Shared | 73 + new date tests (≥ 90) |
| Desktop | 339 + new date tests |
| Admin build | exits 0, emits one `--brand` definition |
| Desktop package | produces an app that boots and shows the new title |

**Verify:** every command exits 0; the captured numbers meet or exceed the table; the
emitted admin CSS contains exactly one `--brand:` occurrence.

**Commit:** `test(phase-7): record the verification suite run`

## Task 3 — Human verification walkthrough

**Evidence:** `phases/07-identity-design-system/evidence/walkthrough.md` plus screenshots

Run in this order and record a screenshot per step:

1. **Admin, light** — sign in; sidebar groups, orange active rail, charcoal fascia, branch
   switcher, user menu. Capture at 1440 px.
2. **Admin, dark** — toggle theme; reload; confirm no light flash and the same layout.
3. **Admin, 375 px** — drawer opens, focus is trapped, Escape closes, nav is reachable.
4. **Admin, keyboard-only** — skip link first, visible focus ring on every control, audit
   list and customers ledger navigate without a mouse.
5. **Admin, print** — open a customer statement, print preview shows no chrome and legible
   tables.
6. **Chart gallery** (both apps) — four widths, light and dark, tooltip on hover and on
   focus, reduced motion honoured.
7. **Dates** — the same timestamp reads identically in the audit list, the credit ledger, and
   the loyalty history; the statement footer and the receipt carry the new format.
8. **Desktop, fresh install** — enrol a terminal (the rename invalidated device tokens),
   sign in with a PIN, open a shift, sell one item cash, print to the fake printer, and
   confirm the receipt columns are unchanged.
9. **Desktop, offline** — stop the API, relaunch, confirm the app opens, the badge reads
   offline without an error, and selling still works.
10. **Desktop, packaged shell** — window title `Sceptre Drive POS`, `app://sceptre-drive`
    origin in devtools, no CSP violation, fonts loaded from the app origin.

Any step that fails is a defect in this phase; fix it before recording the summary.

**Commit:** `docs(phase-7): record the verification walkthrough`

## Task 4 — Write the verification report and update state

**Files:** `.planning/phases/07-identity-design-system/01-VERIFICATION.md`,
`.planning/STATE.md`, `.planning/ROADMAP.md`

- `01-VERIFICATION.md`: goal-backward table — for each success criterion in the roadmap,
  the command or step that proves it, and the observed result. Include the suites capture,
  the contrast table with measured values, the allowlist grep output, and the screenshot
  index.
- `STATE.md`: mark Phase 7 complete with the plan count, record the suite numbers, note the
  re-enrolment consequence, and set the next action to **Plan Phase 8**.
- `ROADMAP.md`: set Phase 7 status to complete with a one-line evidence pointer.
- If any decision deviated during execution, record it in CONTEXT's decisions table rather
  than leaving the plan and the code disagreeing.

**Verify:** the verification report contains no unproven claim — every sentence maps to a
captured artefact. `bun run brand:check` still passes after the docs update (the historical
allowlist does not grow).

**Commit:** `docs(phase-7): complete verification and update state`

## Definition of Done

- All automated gates pass in CI and locally.
- The walkthrough's ten steps are recorded with screenshots.
- STATE and ROADMAP point at the evidence.
- Phase 8 can start with no outstanding identity or token work.
