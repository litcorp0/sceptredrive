# 19-06 — Verification and evidence

**Goal:** prove the phase goal with commands and a realistic file, not with “tasks done”.

**Must be true when done**

- `bun run check-types`, `bun run lint`, `bun run test`, `bun run build` and
  `bun run brand:check` are green (or a failure is named and explained as pre-existing).
- A scratch-database walkthrough uses a 300-line file containing: new products, matched
  products, an oversold product, a zero-quantity catalogue row, a zero-cost line, a duplicate
  barcode, an unknown category and a negative delta. It proves the preview refuses the bad
  rows and the clean post writes exactly the expected products, movements, levels, averages,
  totals and audit.
- Four mutations are applied and caught: allow manager post, allow a partial post, skip the
  idempotency check, allow a negative delta.
- Branch isolation is proven over HTTP: a manager can neither read nor draft another
  branch's document.
- The POS sync check shows a terminal receiving the new level after the post (or the exact
  manual step that proves it if the counter harness is unavailable).
- `sync-config.yaml` has no diff: opening stock is server-side and reaches the till through
  the existing `stock_level` bucket.
- The phase summary records the numbers, deviations and carry-forwards.

## Evidence to capture

- `evidence/suites.txt` — the five gate outputs.
- `evidence/walkthrough.txt` — the script's PASS/FAIL lines and the three re-derived figures
  (counted value, posted value, level sum).
- `evidence/mutations.txt` — each mutation, the test that caught it.
- `19-SUMMARY.md` — what shipped, what was deliberately left, and the known limits.

## Verification commands

```bash
bun run check-types
bun run lint
bun run test
bun run build
bun run brand:check
bun run modules:check:strict
```

The test database must be migrated with `bun run db:test:prepare` after a fresh compose up.
