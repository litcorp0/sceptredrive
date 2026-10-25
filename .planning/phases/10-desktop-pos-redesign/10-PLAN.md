---
phase: 10-desktop-pos-redesign
plan: 10
title: Verification, evidence, and state update
lane: verification + controller
depends_on: [09]
requirements: [UIX-08, UIX-09]
---

# Plan 10 — Verification, evidence, and state update

## Goal

Prove the phase goal backwards, with a command or a recorded human step for every roadmap
success criterion, then write the truth into project memory: the context amendments this phase
actually took, the numbers, the defects it found, and what the next phase inherits.

## Read first

- `ROADMAP.md` § Phase 10 — the five success criteria this file answers.
- `phases/09-analytics-dashboard/01-VERIFICATION.md` — the shape to copy: one section per
  criterion, each naming the evidence.
- `phases/09-analytics-dashboard/evidence/run-suites.sh` — the gate matrix script to adapt.
- `00-DECISIONS.md` — the fifteen decisions to fold into `00-CONTEXT.md`.

## Tasks

### 1. `evidence/run-suites.sh` and `evidence/suites.txt`

Adapt Phase 9's script. Adaptations that matter:

- `modules:check:strict` now covers **both** clients — Plan 05 emptied the desktop's pending
  list, so the strict gate is green from then on;
- `bun run --filter desktop test:counter` needs the API, Postgres, and PowerSync up; it runs
  **after** the fast gates and is marked as requiring the stack in the transcript, so a reader
  can tell an environment failure from a code failure;
- `bun run --filter desktop package` keeps the `npm_config_user_agent` prefix;
- no browser suite runs in parallel with `bun run test` (the Phase 8 note about a false 5 s
  `sync.test.ts` timeout under load).

Capture one transcript at `evidence/suites.txt`.

### 2. `01-VERIFICATION.md` — one section per success criterion

| Roadmap criterion | Evidence |
|---|---|
| 1. `modules/` holds every POS domain with the seven folders; routes resolve a hash route to a module page | `bun run modules:check:pos:strict` (14/14), `find desktop/src/renderer/modules -maxdepth 2 -type d`, and the route-file line counts |
| 2. Sign in → shift home → take, drawer, credit, items, hourly shape, top sellers → sell in one action | counter audit §2–3 (`#home` landing, figures equal to the script's own arithmetic, F2/Enter path) |
| 3. Home and every redesigned screen work unplugged; charts read local SQLite | counter audit §7 (offline sale, relaunch, figures intact); the query file contains no `fetch`/`api` import |
| 4. No money rule changed: desktop suite, E2E, walkthrough, packaged shell, packaged print all pass | `suites.txt`: desktop suite count, `test:e2e`, `test:print`, the offline walkthrough leg |
| 5. Offline is normal; no hover-only action | counter audit §4 and §7; `grep` for `group-hover`/`peer-hover` in `modules/**` returning nothing |

Each section names the command, the observed count, and — where a number could drift — the
figure the phase started from.

### 3. Fold the decisions back into `00-CONTEXT.md`

Append an **Amendments (2026-10-25)** section listing P10-D1…P10-D15 in one table: the decision,
the reason in one line, and the plan that implemented it. The locked-decisions table keeps its
original rows; D5 gains a footnote pointing at P10-D1/D2/D4, D6 at P10-D6/D7, D13 at P10-D8.

This is Phase 9's convention and it is the only way `00-CONTEXT.md` can stay "locked" and honest
at the same time.

### 4. Wire the desktop gate into CI

- Root `package.json`: `modules:check:strict` runs the admin and desktop gates.
- `.github/workflows/ci.yml`: no new step if `check-modules` is already invoked through the root
  script; confirm and note it.
- `desktop/package.json`: `test:counter` present and documented in `desktop/README.md` with its
  stack prerequisites.

### 5. `STATE.md`

- Progress table: Phase 10 → ✅ Complete (10/10 plans, verified), with the date.
- A `### Phase 10 plan progress` table, ten rows, all complete.
- `### Phase 10 execution notes`:
  - **numbers**: shared, API, desktop, counter-audit, walkthrough, module gate, bundle bytes
    before and after;
  - **decisions taken in planning** with a pointer to `00-DECISIONS.md`;
  - **deviations**: the test assertions updated for the new landing screen (Plan 05) and why;
    Phase 7's `verify-charts-desktop.mjs` left as history and superseded by the counter audit;
    P10-D8's light-only matrix;
  - **defects found and fixed**: the diagnostics shell on first install; the clipped product
    name; two float round-trips in money inputs; ~100 raw palette classes across the renderer;
    the stale `dev-charts` exemption in the admin gate;
  - **carry-forwards**: `stock_threshold` sync (Phase 11), held carts and refunds (Phase 13),
    a dark till if ever wanted (unscheduled), and the `#spike` panel's eventual retirement.
- `Next action:` → Plan **Phase 11** (Procurement, Replenishment & Supplier Returns).

### 6. `ROADMAP.md`

Phase 10 gains a `**Status:** ✅ Complete (verified <date> — see
phases/10-desktop-pos-redesign/01-VERIFICATION.md)` line matching the other completed phases.

## Verification

```bash
bash .planning/phases/10-desktop-pos-redesign/evidence/run-suites.sh
```

Expected, at minimum:

- `bun run lint` clean;
- `bun run check-types` 6/6;
- `bun run brand:check` OK;
- `bun run tokens:check` OK (no literal colour leaked in from the shadcn run);
- `bun run modules:check:strict` green over both clients;
- `bun run test` — API ≥ 394 (unchanged except the shared helper adoption), shared ≥ 140,
  desktop ≥ 360;
- `bun run --filter admin build` and `bun run --filter desktop package` green;
- `bun run --filter desktop test:counter` ≥ 60/60 with the stack up;
- `bun run --filter desktop test:print` 21/21;
- the packaged shell smoke green.

The transcript is committed with the plan.

## Commits

1. `docs(10): the gate matrix and its transcript`
2. `test(10): map every success criterion to its evidence`
3. `docs(10): fold the planning decisions into the locked context`
4. `chore(scripts): run the desktop module gate in CI`
5. `docs(10): state and roadmap for a verified phase`

## Done when

- Every roadmap success criterion has a named command or recorded step with an observed result.
- `00-CONTEXT.md`, `STATE.md`, and `ROADMAP.md` agree with the code and with each other.
- A reader who has never seen this phase can run one script and reproduce the whole claim.
