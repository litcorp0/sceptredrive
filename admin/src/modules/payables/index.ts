/**
 * `payables` — supplier invoices (standalone or copied from a goods receipt), supplier payments
 * and their allocations, supplier balances, and the payables aging report.
 *
 * Migration note (Phase 8): the section lived in `components/payables/` (ten files) and in six
 * routes owned by the `/suppliers/…` URL, not by this domain — `suppliers/invoices`,
 * `suppliers/invoices/new`, `suppliers/invoices/$invoiceId`, `suppliers/payments`,
 * `suppliers/payments/$paymentId` and `suppliers/aging`. They are now pages here and each route
 * only routes (decisions D6, D9 — a move, not a rewrite). The URL never changes: a route file
 * declares a path, the module owns the screen.
 *
 * The API keys keep the pre-Phase-8 roots (`["supplier-invoices"]`, `["supplier-invoice"]`,
 * `["supplier-payments"]`, `["supplier-payment"]`, `["supplier-balances"]`,
 * `["payment-outstanding"]`, `["invoice-receipt-options"]`, `["invoice-receipt"]`,
 * `["invoice-supplier"]`, `["receipt-invoice"]`, `["payables-aging"]`) because the dialogs
 * invalidate them by prefix from several places. Money stays integer minor units and is only ever
 * formatted here: the API returns `outstandingMinor`, `amountPaidMinor` and every bucket, and the
 * console never recomputes a balance, a total or an aging bucket.
 *
 * Two reads cross the module boundary in each direction, and both are deliberate:
 * this module reads goods receipts and supplier payment details through the `inventory` and
 * `suppliers` barrels, and `inventory`'s receipt screen reads the linked invoice from here.
 * The invoice status badge those screens share lives in `components/common`, so no component is
 * imported across the boundary.
 *
 * The barrel is the only entry point.
 */

export { payablesKeys } from "./api/keys"
export {
	createInvoice,
	createPayment,
	getInvoice,
	getPayablesAging,
	getPayment,
	invoiceDetailOptions,
	invoiceListOptions,
	invoiceSupplierOptions,
	listInvoices,
	listPayments,
	listSupplierBalances,
	payablesAgingOptions,
	paymentDetailOptions,
	paymentListOptions,
	paymentOutstandingOptions,
	receiptInvoiceOptions,
	receiptPickerOptions,
	receiptSourceOptions,
	supplierBalancesOptions,
	voidInvoice,
	voidPayment,
} from "./api/payables"
export type {
	AgingBucketKey,
	AgingBuckets,
	AllocationKind,
	InvoiceCreateInput,
	InvoiceLineInput,
	InvoiceVoidInput,
	PayableAgingInvoice,
	PayableAgingSupplier,
	PayablesAgingQuery,
	PayablesAgingResult,
	PaymentAllocationInput,
	PaymentCreateInput,
	PaymentListQuery,
	PaymentListResult,
	PaymentVoidInput,
	SupplierBalance,
	SupplierBalanceResult,
	SupplierInvoice,
	SupplierInvoiceAllocation,
	SupplierInvoiceDetail,
	SupplierInvoiceLine,
	SupplierInvoiceListQuery,
	SupplierInvoiceListResult,
	SupplierInvoiceRow,
	SupplierInvoiceStatus,
	SupplierInvoiceVoidReason,
	SupplierPayment,
	SupplierPaymentAllocation,
	SupplierPaymentDetail,
	SupplierPaymentMethod,
	SupplierPaymentRow,
	SupplierPaymentStatus,
	SupplierPaymentVoidReason,
} from "./types"
