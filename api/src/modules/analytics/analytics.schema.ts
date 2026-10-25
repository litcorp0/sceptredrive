/**
 * The analytics module owns no tables.
 *
 * Every figure is an aggregate over ledgers and projections owned elsewhere: `sale`,
 * `sale_line`, `sale_tender` (pos), `stock_level`/`stock_movement` (inventory),
 * `credit_ledger_entry`/`credit_profile` (credit), `loyalty_*` (loyalty), and
 * `supplier_invoice`/`supplier_payment` (payables). The read-model boundary is recorded in
 * `00-DECISIONS.md` P9-D10 and in the header of `analytics.repository.ts`.
 */
export {}
