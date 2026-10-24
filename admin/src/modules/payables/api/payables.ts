import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import { getReceipt, listReceipts } from "#/modules/inventory"
import { getSupplier } from "#/modules/suppliers"
import type {
	InvoiceCreateInput,
	InvoiceVoidInput,
	PayablesAgingQuery,
	PayablesAgingResult,
	PaymentCreateInput,
	PaymentListQuery,
	PaymentListResult,
	PaymentVoidInput,
	SupplierBalanceResult,
	SupplierInvoiceDetail,
	SupplierInvoiceListQuery,
	SupplierInvoiceListResult,
	SupplierInvoiceRow,
	SupplierPaymentDetail,
} from "../types"
import { payablesKeys } from "./keys"

/** `GET /api/payables/invoices` — the invoice list, filtered and paged by the screen. */
export function listInvoices(query: SupplierInvoiceListQuery = {}) {
	return apiRequest<SupplierInvoiceListResult>("/api/payables/invoices", { query })
}

export function invoiceListOptions(filters: SupplierInvoiceListQuery) {
	return queryOptions({
		queryKey: payablesKeys.invoiceList(filters),
		queryFn: () => listInvoices(filters),
	})
}

/** `GET /api/payables/invoices/:id` — the invoice, its lines and its allocation history. */
export function getInvoice(id: string) {
	return apiRequest<SupplierInvoiceDetail>(`/api/payables/invoices/${id}`)
}

export function invoiceDetailOptions(invoiceId: string) {
	return queryOptions({
		queryKey: payablesKeys.invoiceDetail(invoiceId),
		queryFn: () => getInvoice(invoiceId),
	})
}

/** The server derives every total and the idempotency replay; the console sends the lines. */
export function createInvoice(input: InvoiceCreateInput) {
	return apiRequest<{ invoice: SupplierInvoiceDetail; replayed: boolean }>(
		"/api/payables/invoices",
		{ method: "POST", body: input },
	)
}

export function voidInvoice(id: string, input: InvoiceVoidInput) {
	return apiRequest<{ invoice: SupplierInvoiceRow }>(`/api/payables/invoices/${id}/void`, {
		method: "POST",
		body: input,
	})
}

/** `GET /api/payables/payments` — the payment list with its allocation totals. */
export function listPayments(query: PaymentListQuery = {}) {
	return apiRequest<PaymentListResult>("/api/payables/payments", { query })
}

export function paymentListOptions(filters: PaymentListQuery) {
	return queryOptions({
		queryKey: payablesKeys.paymentList(filters),
		queryFn: () => listPayments(filters),
	})
}

/** `GET /api/payables/payments/:id` — the payment, its allocations and its on-account share. */
export function getPayment(id: string) {
	return apiRequest<SupplierPaymentDetail>(`/api/payables/payments/${id}`)
}

export function paymentDetailOptions(paymentId: string) {
	return queryOptions({
		queryKey: payablesKeys.paymentDetail(paymentId),
		queryFn: () => getPayment(paymentId),
	})
}

export function createPayment(input: PaymentCreateInput) {
	return apiRequest<{ payment: SupplierPaymentDetail; replayed: boolean }>(
		"/api/payables/payments",
		{ method: "POST", body: input },
	)
}

export function voidPayment(id: string, input: PaymentVoidInput) {
	return apiRequest<{ payment: SupplierPaymentDetail }>(`/api/payables/payments/${id}/void`, {
		method: "POST",
		body: input,
	})
}

/** `GET /api/payables/balances` — one aggregated row per supplier; branch-scoped by the API. */
export function listSupplierBalances(query: { branchId?: string } = {}) {
	return apiRequest<SupplierBalanceResult>("/api/payables/balances", { query })
}

export function supplierBalancesOptions() {
	return queryOptions({
		queryKey: payablesKeys.balances,
		queryFn: () => listSupplierBalances(),
	})
}

/** `GET /api/payables/aging` — fixed due-date buckets as of one day. */
export function getPayablesAging(query: PayablesAgingQuery = {}) {
	return apiRequest<PayablesAgingResult>("/api/payables/aging", { query })
}

export function payablesAgingOptions(
	branchId: string | null | undefined,
	asOf: string,
	supplierId: string | null,
) {
	return queryOptions({
		queryKey: payablesKeys.agingReport(branchId, asOf, supplierId),
		queryFn: () =>
			getPayablesAging({
				branchId: branchId ?? undefined,
				asOf: asOf || undefined,
				supplierId: supplierId ?? undefined,
			}),
	})
}

/**
 * The purchase invoice recorded against a goods receipt.
 *
 * The read belongs to payables even though the goods receipt screen renders it: the linked
 * invoice is a payable, and `modules/inventory` must not own a payables fetcher. It is the one
 * honest `inventory → payables` edge in the console.
 */
export function receiptInvoiceOptions(receiptId: string) {
	return queryOptions({
		queryKey: payablesKeys.receiptInvoiceFor(receiptId),
		queryFn: () => listInvoices({ receiptId, limit: 1 }),
	})
}

/**
 * The outstanding invoices a payment can be allocated to. The list is the API's own
 * `outstandingMinor`; nothing here recomputes a balance.
 */
export function paymentOutstandingOptions(supplierId: string | null, branchId: string | null) {
	return queryOptions({
		queryKey: payablesKeys.outstandingFor(supplierId, branchId),
		queryFn: () =>
			listInvoices({
				supplierId: supplierId as string,
				branchId: branchId || undefined,
				limit: 100,
				offset: 0,
			}),
		enabled: supplierId !== null,
	})
}

/**
 * The invoice form's receipt picker. Reads goods receipts through the inventory barrel — the one
 * sanctioned `payables → inventory` edge, because an invoice is recorded against a receipt.
 */
export function receiptPickerOptions(branchId: string, canSelectBranch: boolean) {
	return queryOptions({
		queryKey: payablesKeys.receiptOptionsFor(branchId),
		queryFn: () => listReceipts({ branchId: branchId || undefined, limit: 50 }),
		enabled: branchId !== "" || canSelectBranch,
	})
}

/** Pre-selection from `?receiptId=`: one receipt, loaded once by the invoice form. */
export function receiptSourceOptions(receiptId: string | undefined) {
	return queryOptions({
		queryKey: payablesKeys.receiptFor(receiptId),
		queryFn: () => getReceipt(receiptId as string),
		enabled: Boolean(receiptId),
	})
}

/**
 * Pre-selection from `?supplierId=`: the supplier's terms default the due date. Reads the supplier
 * master through its barrel (`payables → suppliers`), never the supplier store directly.
 */
export function invoiceSupplierOptions(
	supplierId: string | undefined,
	receiptId: string | undefined,
) {
	return queryOptions({
		queryKey: payablesKeys.invoiceSupplierFor(supplierId),
		queryFn: () => getSupplier(supplierId as string),
		enabled: Boolean(supplierId) && !receiptId,
	})
}
