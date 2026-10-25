/**
 * The replenishment module owns no tables.
 *
 * Every figure is an aggregate over tables owned elsewhere: `stock_threshold`,
 * `stock_level` and `sale_line` (inventory, pos), `supplier_product` (suppliers),
 * and `purchase_order_line`/`stock_receipt_line` (procurement). The read-model
 * boundary is the same one Phase 9 recorded for analytics (P9-D10).
 */
export {}
