/**
 * `receipt` — the committed sale's receipt and its print orchestration.
 * Printing never blocks the next sale; failures surface here and do not touch
 * the sale.
 */
export { ReceiptScreen } from './pages/receipt-page'
