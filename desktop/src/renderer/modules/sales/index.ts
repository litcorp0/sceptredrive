/**
 * `sales` — today's sales on this terminal, the local reprint path.
 * Branch and company takings are the console's job, not this page's.
 *
 * `useUnprintedCount` is here because the header and Plan 04's home strip both
 * show it; the SQL must not live in either consumer.
 */
export { useUnprintedCount } from './api/queries'
export { SalesScreen } from './pages/sales-page'
