/**
 * The operations summary has no data access of its own, deliberately.
 *
 * A repository here would have to reach into `approval`, `transfer`,
 * `stock_write_off`, `shift`, `stock_level`/`stock_threshold`, `credit_profile`
 * and `stock_count` at once, and each of those tables is already counted by an
 * owning service whose `total` its own list endpoint returns. Reading the tables
 * again would be the boundary Phase 9 forbade (P9-D10) *and* the way a summary
 * drifts from the list it links to: two predicates for one number. The service
 * composes the owners instead (`operations.service.ts`), so parity is structural.
 */
export {}
