import type { PaymentListQuery, SupplierInvoiceListQuery } from "../types"

/**
 * Every key the payables module owns.
 *
 * The roots are spelled exactly as they were before Phase 8 — `["supplier-invoices"]`,
 * `["supplier-invoice"]`, `["supplier-payments"]`, `["supplier-payment"]`, `["supplier-balances"]`,
 * `["payment-outstanding"]`, `["invoice-receipt-options"]`, `["invoice-receipt"]`,
 * `["invoice-supplier"]`, `["receipt-invoice"]` and `["payables-aging"]` — because the dialogs
 * invalidate them by prefix
 * from several places, and the supplier list reads the balance root by hand. A renamed root would
 * still typecheck and still render, but an invoice or a payment would stop refreshing after a
 * posting.
 */
export const payablesKeys = {
	invoices: ["supplier-invoices"] as const,
	invoice: ["supplier-invoice"] as const,
	payments: ["supplier-payments"] as const,
	payment: ["supplier-payment"] as const,
	balances: ["supplier-balances"] as const,
	outstanding: ["payment-outstanding"] as const,
	receiptOptions: ["invoice-receipt-options"] as const,
	receipt: ["invoice-receipt"] as const,
	invoiceSupplier: ["invoice-supplier"] as const,
	receiptInvoice: ["receipt-invoice"] as const,
	aging: ["payables-aging"] as const,

	invoiceList: (filters: SupplierInvoiceListQuery) => [...payablesKeys.invoices, filters] as const,
	invoiceDetail: (invoiceId: string) => [...payablesKeys.invoice, invoiceId] as const,
	paymentList: (filters: PaymentListQuery) => [...payablesKeys.payments, filters] as const,
	paymentDetail: (paymentId: string) => [...payablesKeys.payment, paymentId] as const,
	outstandingFor: (supplierId: string | null, branchId: string | null) =>
		[...payablesKeys.outstanding, supplierId, branchId] as const,
	receiptOptionsFor: (branchId: string) => [...payablesKeys.receiptOptions, branchId] as const,
	receiptFor: (receiptId: string | undefined) => [...payablesKeys.receipt, receiptId] as const,
	invoiceSupplierFor: (supplierId: string | undefined) =>
		[...payablesKeys.invoiceSupplier, supplierId] as const,
	receiptInvoiceFor: (receiptId: string) => [...payablesKeys.receiptInvoice, receiptId] as const,
	agingReport: (branchId: string | null | undefined, asOf: string, supplierId: string | null) =>
		[...payablesKeys.aging, branchId, asOf, supplierId] as const,
}
