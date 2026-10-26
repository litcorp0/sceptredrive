/**
 * The operations module owns no tables.
 *
 * Every figure is read through the service that owns it: `approval` (approvals),
 * `transfer` (transfers), `stock_write_off` (writeoffs), `shift` (pos),
 * `stock_level`/`stock_threshold` (inventory), `credit_profile` (credit) and
 * `stock_count` (counts). The read-model boundary is the one Phase 9 recorded for
 * analytics (P9-D10) — and this module goes one step further: rather than
 * re-reading those tables, it calls their services, so a queue can never be
 * counted with a predicate its own list does not use (P12-D37).
 */
export {}
