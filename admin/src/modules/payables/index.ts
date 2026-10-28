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
 * `suppliers` barrels, `inventory`'s receipt screen reads the linked invoice from here, and the
 * supplier list reads `supplierBalancesOptions` from here. The invoice status badge those screens
 * share lives in `components/common`, so no component is imported across the boundary.
 *
 * The barrel is the only entry point.
 */

export { payablesKeys } from "./api/keys"
export {
	createInvoice,
	createPayment,
	createTransfer,
	finalizeTransfer,
	getInvoice,
	getPayablesAging,
	getPayment,
	getProviderBalance,
	getTransfer,
	getTransferReconciliation,
	invoiceDetailOptions,
	invoiceListOptions,
	invoiceSupplierOptions,
	listInvoices,
	listPayments,
	listSupplierBalances,
	listTransfers,
	payablesAgingOptions,
	paymentDetailOptions,
	paymentListOptions,
	paymentOutstandingOptions,
	providerBalanceOptions,
	receiptInvoiceOptions,
	receiptPickerOptions,
	receiptSourceOptions,
	supplierBalancesOptions,
	transferDetailOptions,
	transferListOptions,
	transferReconciliationOptions,
	verifyTransfer,
	voidInvoice,
	voidPayment,
} from "./api/payables"
export { PayablesAgingTable } from "./components/aging-table"
export {
	type AllocationDraft,
	AllocationEditor,
	allocationDraftInputs,
	allocationDraftsTotal,
} from "./components/allocation-editor"
export { InvoiceForm } from "./components/invoice-form"
export {
	createInvoiceLineDraft,
	type InvoiceLineDraft,
	InvoiceLinesEditor,
	invoiceLineDraftsSum,
	invoiceLineDraftTotal,
	toInvoiceLineInputs,
	validateInvoiceLineDraft,
} from "./components/invoice-lines-editor"
export { PayablesSummaryCards } from "./components/payables-summary-cards"
export { type InvoicePaymentTarget, PaymentFormDialog } from "./components/payment-form-dialog"
export { PaymentMethodBadge } from "./components/payment-method-badge"
export { TransferDialog } from "./components/transfer-dialog"
export { TransferOtpForm } from "./components/transfer-otp-form"
export { TransferStatusBadge, transferStatusVariant } from "./components/transfer-status-badge"
export { VoidInvoiceDialog } from "./components/void-invoice-dialog"
export { VoidPaymentDialog } from "./components/void-payment-dialog"
export { InvoiceDetailPage } from "./pages/invoice-detail-page"
export { InvoiceNewPage } from "./pages/invoice-new-page"
export { InvoicesPage } from "./pages/invoices-page"
export { PayablesAgingPage } from "./pages/payables-aging-page"
export { PaymentDetailPage } from "./pages/payment-detail-page"
export { PaymentsPage } from "./pages/payments-page"
export { ReconciliationPage } from "./pages/reconciliation-page"
export { TransferDetailPage } from "./pages/transfer-detail-page"
export { TransfersPage } from "./pages/transfers-page"
export type {
	AgingBucketKey,
	AgingBuckets,
	AllocationKind,
	InvoiceCreateInput,
	InvoiceLineInput,
	InvoiceMatch,
	InvoiceMatchLine,
	InvoiceMatchStatus,
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
	ProviderBalanceView,
	ReconciliationState,
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
	TransferAllocationView,
	TransferCreateInput,
	TransferCreateResult,
	TransferDetail,
	TransferFinalizeInput,
	TransferListQuery,
	TransferListResult,
	TransferMethod,
	TransferReconciliationQuery,
	TransferReconciliationResult,
	TransferReconciliationRow,
	TransferStatus,
	TransferView,
} from "./types"
export {
	RECONCILIATION_STATES,
	type ReconciliationSearch,
	reconciliationSearchSchema,
	type TransferSearch,
	transferSearchSchema,
} from "./utils/transfer-search"
