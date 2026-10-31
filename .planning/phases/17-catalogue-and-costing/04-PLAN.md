# 17-04 — Zero cost is reported as unknown, never as 100%

**Goal:** a dashboard cannot imply a business is making a 100% margin on goods it never
bought.

**Must be true when done**

- `marginBp` is `null` on the overview when **all** revenue in the window is uncosted.
- The overview exposes how much revenue is uncosted (`uncostedRevenueMinor`) and how many
  lines it covers, so the console can say "N sales with no cost known".
- A top-product row whose sold quantity carries no cost reports `marginBp: null`, not 100%.
- A partly-costed window keeps a real margin figure **and** the uncosted amount, so the
  reader can judge it.
- Nothing about the money columns changes: gross profit is still revenue − cost.

## Tasks

1. `analytics.repository.ts#selectLineTotals`: add
   `SUM(l.base_minor) FILTER (WHERE l.unit_cost_minor = 0)` and
   `COUNT(*) FILTER (WHERE l.unit_cost_minor = 0)`.
2. `analytics.types.ts`: add `uncostedRevenueMinor` and `uncostedLines` to `LineTotals` and
   `OverviewTotals`.
3. `analytics.service.ts`: pass them through; compute `marginBp` as `null` when
   `revenueBaseMinor > 0 && uncostedRevenueMinor === revenueBaseMinor`.
4. `analytics.repository.ts#selectTopProducts`: `marginBp` null when `costMinor === 0` and
   quantity > 0.
5. Console: the overview margin tile shows `—` with "no cost known" when null, and the top
   products table shows `—` for those rows.
6. Tests in `analytics.test.ts`: an all-uncosted window, a mixed window, and a fully costed
   window.

## Notes

- The figure is not removed: a mixed window's margin is real information, annotated with the
  revenue it cannot explain.
- This plan does not change how cost is obtained; that is 03 and 05.

## Verification

`bunx vitest run src/modules/analytics`, plus a typecheck of the console.
