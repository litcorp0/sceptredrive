/**
 * `#pos/refund` — routes only. The screen is
 * `modules/refund/pages/refund-page.tsx`.
 *
 * It lives under the POS shell rather than as a top-level hash so it inherits
 * the same guards as selling: a staff session, a configured terminal, and an
 * open shift. A refund pays money out of that shift's drawer, so it cannot run
 * without one.
 */
export { RefundScreen } from '@/modules/refund'
