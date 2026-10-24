import { env } from "#/env"
import type {
	AdjustmentCreateInput,
	AgingQuery,
	AgingResult,
	CountCreateInput,
	CountListQuery,
	CreditEntryCreateInput,
	CreditEntryListQuery,
	CreditEntryListResult,
	CreditPostingResult,
	CreditProfile,
	CreditProfileListRow,
	CreditProfileUpdateInput,
	CreditStatement,
	CustomerCreateInput,
	CustomerDetail,
	CustomerListQuery,
	CustomerListRow,
	CustomerSearchResult,
	CustomerUpdateInput,
	InventoryReceipt,
	InvoiceCreateInput,
	InvoiceVoidInput,
	LoyaltyAccountDetail,
	LoyaltyEntryCreateInput,
	LoyaltyLiabilityQuery,
	LoyaltyLiabilityReport,
	LoyaltyPostingResult,
	MovementListQuery,
	MovementRow,
	PayablesAgingQuery,
	PayablesAgingResult,
	PaymentCreateInput,
	PaymentDetailInput,
	PaymentDetailUpdateInput,
	PaymentListQuery,
	PaymentListResult,
	PaymentVoidInput,
	ReceiptCreateInput,
	ReceiptListQuery,
	RepaymentCreateInput,
	StatementQuery,
	StockCount,
	StockDetail,
	StockListQuery,
	StockRow,
	StockThreshold,
	Supplier,
	SupplierBalanceResult,
	SupplierCreateInput,
	SupplierDetail,
	SupplierInvoiceDetail,
	SupplierInvoiceListQuery,
	SupplierInvoiceListResult,
	SupplierInvoiceRow,
	SupplierListQuery,
	SupplierListResult,
	SupplierPaymentDetail,
	SupplierPaymentDetailView,
	SupplierProductInput,
	SupplierProductMapping,
	SupplierProductUpdateInput,
	SupplierUpdateInput,
	ThresholdInput,
	Transfer,
	TransferCreateInput,
	TransferListQuery,
} from "./api-types"

export class ApiError extends Error {
	readonly status: number
	readonly code: string
	readonly requestId: string | undefined
	readonly details: Record<string, unknown> | undefined

	constructor(
		status: number,
		code: string,
		message: string,
		requestId?: string,
		details?: Record<string, unknown>,
	) {
		super(message)
		this.name = "ApiError"
		this.status = status
		this.code = code
		this.requestId = requestId
		this.details = details
	}
}

type QueryValue = string | number | boolean | undefined

interface RequestOptions {
	method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"
	body?: unknown
	query?: Record<string, QueryValue>
	signal?: AbortSignal
	/** Set to false for calls made from the login flow itself. */
	redirectOn401?: boolean
}

function buildUrl(path: string, query?: Record<string, QueryValue>): URL {
	const url = new URL(path, env.VITE_API_URL)
	if (query) {
		for (const [key, value] of Object.entries(query)) {
			if (value === undefined) continue
			url.searchParams.set(key, String(value))
		}
	}
	return url
}

function currentLocation(): string {
	if (typeof window === "undefined") return "/"
	return window.location.pathname + window.location.search
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
	const response = await fetch(buildUrl(path, options.query), {
		method: options.method ?? "GET",
		credentials: "include",
		headers: {
			Accept: "application/json",
			...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
		},
		body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
		signal: options.signal,
	})

	if (!response.ok) {
		let envelope:
			| { message?: string; code?: string; requestId?: string; details?: Record<string, unknown> }
			| undefined
		try {
			const payload = (await response.json()) as { error?: typeof envelope } | null
			envelope = payload?.error
		} catch {
			envelope = undefined
		}

		const requestId = envelope?.requestId ?? response.headers.get("x-request-id") ?? undefined

		if (
			response.status === 401 &&
			options.redirectOn401 !== false &&
			typeof window !== "undefined"
		) {
			const redirect = encodeURIComponent(currentLocation())
			window.location.assign(`/login?redirect=${redirect}`)
		}

		throw new ApiError(
			response.status,
			envelope?.code ?? "HTTP_ERROR",
			envelope?.message ?? "Request failed",
			requestId,
			envelope?.details,
		)
	}

	if (response.status === 204) return undefined as T
	return (await response.json()) as T
}

/** True when the API asks for a fresh sign-in before a sensitive action. */
export function isReauthRequired(error: unknown): boolean {
	return error instanceof ApiError && error.code === "REAUTH_REQUIRED"
}

export const api = {
	customers: {
		list: (query: CustomerListQuery = {}) =>
			apiRequest<CustomerSearchResult>("/api/customers", { query }),
		get: (id: string) => apiRequest<CustomerDetail>(`/api/customers/${id}`),
		create: (input: CustomerCreateInput) =>
			apiRequest<{ customer: CustomerListRow }>("/api/customers", {
				method: "POST",
				body: input,
			}),
		update: (id: string, input: CustomerUpdateInput) =>
			apiRequest<{ customer: CustomerListRow }>(`/api/customers/${id}`, {
				method: "PATCH",
				body: input,
			}),
		archive: (id: string, note?: string) =>
			apiRequest<{ customer: CustomerListRow }>(`/api/customers/${id}/archive`, {
				method: "POST",
				body: { note: note || undefined },
			}),
		reactivate: (id: string) =>
			apiRequest<{ customer: CustomerListRow }>(`/api/customers/${id}/reactivate`, {
				method: "POST",
			}),
		anonymize: (id: string, note?: string) =>
			apiRequest<{ customer: CustomerListRow }>(`/api/customers/${id}/anonymize`, {
				method: "POST",
				body: { note: note || undefined },
			}),
	},

	credit: {
		aging: (query: AgingQuery) => apiRequest<AgingResult>("/api/credit/aging", { query }),
		statement: (customerId: string, query: StatementQuery) =>
			apiRequest<CreditStatement>(`/api/credit/statements/${customerId}`, { query }),
		profiles: {
			list: (query: { customerId: string; branchId?: string }) =>
				apiRequest<{ profiles: CreditProfileListRow[] }>("/api/credit/profiles", { query }),
			update: (customerId: string, input: CreditProfileUpdateInput) =>
				apiRequest<{ profile: CreditProfile }>(`/api/credit/profiles/${customerId}`, {
					method: "PUT",
					body: input,
				}),
		},
		entries: {
			list: (query: CreditEntryListQuery) =>
				apiRequest<CreditEntryListResult>("/api/credit/entries", { query }),
			create: (input: CreditEntryCreateInput) =>
				apiRequest<CreditPostingResult>("/api/credit/entries", { method: "POST", body: input }),
		},
		repayments: {
			create: (input: RepaymentCreateInput) =>
				apiRequest<CreditPostingResult>("/api/credit/repayments", {
					method: "POST",
					body: input,
				}),
		},
	},

	loyalty: {
		account: (customerId: string) =>
			apiRequest<LoyaltyAccountDetail>(`/api/loyalty/accounts/${customerId}`),
		entries: {
			create: (input: LoyaltyEntryCreateInput) =>
				apiRequest<LoyaltyPostingResult>("/api/loyalty/entries", { method: "POST", body: input }),
		},
		liability: (query: LoyaltyLiabilityQuery = {}) =>
			apiRequest<LoyaltyLiabilityReport>("/api/loyalty/liability", { query }),
	},

	inventory: {
		stock: {
			list: (query: StockListQuery = {}) =>
				apiRequest<{ stock: StockRow[]; total: number; branchId: string }>("/api/inventory/stock", {
					query,
				}),
			lowStock: (query: StockListQuery = {}) =>
				apiRequest<{ stock: StockRow[]; total: number; branchId: string }>(
					"/api/inventory/low-stock",
					{ query },
				),
			get: (productId: string, query: { branchId?: string } = {}) =>
				apiRequest<{ stock: StockDetail }>(`/api/inventory/stock/${productId}`, { query }),
		},
		movements: {
			list: (query: MovementListQuery = {}) =>
				apiRequest<{ movements: MovementRow[]; total: number; branchId: string | null }>(
					"/api/inventory/movements",
					{ query },
				),
		},
		receipts: {
			list: (query: ReceiptListQuery = {}) =>
				apiRequest<{ receipts: InventoryReceipt[]; total: number; branchId: string | null }>(
					"/api/inventory/receipts",
					{ query },
				),
			get: (id: string) =>
				apiRequest<{ receipt: InventoryReceipt }>(`/api/inventory/receipts/${id}`),
			create: (input: ReceiptCreateInput) =>
				apiRequest<{ receipt: InventoryReceipt }>("/api/inventory/receipts", {
					method: "POST",
					body: input,
				}),
		},
		adjustments: {
			create: (input: AdjustmentCreateInput) =>
				apiRequest<{ movement: MovementRow; level: { quantityOnHand: number } }>(
					"/api/inventory/adjustments",
					{ method: "POST", body: input },
				),
		},
		thresholds: {
			list: (query: { branchId?: string } = {}) =>
				apiRequest<{ thresholds: StockThreshold[]; branchId: string }>(
					"/api/inventory/thresholds",
					{ query },
				),
			set: (input: ThresholdInput) =>
				apiRequest<{ threshold: StockThreshold }>("/api/inventory/thresholds", {
					method: "PUT",
					body: input,
				}),
			remove: (productId: string, query: { branchId?: string } = {}) =>
				apiRequest<{ ok: true }>(`/api/inventory/thresholds/${productId}`, {
					method: "DELETE",
					query,
				}),
		},
	},
	suppliers: {
		list: (query: SupplierListQuery = {}) =>
			apiRequest<SupplierListResult>("/api/suppliers", { query }),
		get: (id: string) => apiRequest<SupplierDetail>(`/api/suppliers/${id}`),
		create: (input: SupplierCreateInput) =>
			apiRequest<{ supplier: Supplier }>("/api/suppliers", {
				method: "POST",
				body: input,
			}),
		update: (id: string, input: SupplierUpdateInput) =>
			apiRequest<{ supplier: Supplier }>(`/api/suppliers/${id}`, {
				method: "PATCH",
				body: input,
			}),
		archive: (id: string, note?: string) =>
			apiRequest<{ supplier: Supplier }>(`/api/suppliers/${id}/archive`, {
				method: "POST",
				body: { note: note || undefined },
			}),
		reactivate: (id: string) =>
			apiRequest<{ supplier: Supplier }>(`/api/suppliers/${id}/reactivate`, {
				method: "POST",
			}),
		addPaymentDetail: (id: string, input: PaymentDetailInput) =>
			apiRequest<{ paymentDetail: SupplierPaymentDetailView }>(
				`/api/suppliers/${id}/payment-details`,
				{
					method: "POST",
					body: input,
				},
			),
		updatePaymentDetail: (id: string, detailId: string, input: PaymentDetailUpdateInput) =>
			apiRequest<{ paymentDetail: SupplierPaymentDetailView }>(
				`/api/suppliers/${id}/payment-details/${detailId}`,
				{ method: "PATCH", body: input },
			),
		addProduct: (id: string, input: SupplierProductInput) =>
			apiRequest<{ mapping: SupplierProductMapping }>(`/api/suppliers/${id}/products`, {
				method: "POST",
				body: input,
			}),
		updateProduct: (id: string, mappingId: string, input: SupplierProductUpdateInput) =>
			apiRequest<{ mapping: SupplierProductMapping }>(
				`/api/suppliers/${id}/products/${mappingId}`,
				{ method: "PATCH", body: input },
			),
		removeProduct: (id: string, mappingId: string) =>
			apiRequest<{ ok: true }>(`/api/suppliers/${id}/products/${mappingId}`, {
				method: "DELETE",
			}),
	},

	payables: {
		invoices: {
			list: (query: SupplierInvoiceListQuery = {}) =>
				apiRequest<SupplierInvoiceListResult>("/api/payables/invoices", { query }),
			get: (id: string) => apiRequest<SupplierInvoiceDetail>(`/api/payables/invoices/${id}`),
			create: (input: InvoiceCreateInput) =>
				apiRequest<{ invoice: SupplierInvoiceDetail; replayed: boolean }>(
					"/api/payables/invoices",
					{ method: "POST", body: input },
				),
			void: (id: string, input: InvoiceVoidInput) =>
				apiRequest<{ invoice: SupplierInvoiceRow }>(`/api/payables/invoices/${id}/void`, {
					method: "POST",
					body: input,
				}),
		},
		payments: {
			list: (query: PaymentListQuery = {}) =>
				apiRequest<PaymentListResult>("/api/payables/payments", { query }),
			get: (id: string) => apiRequest<SupplierPaymentDetail>(`/api/payables/payments/${id}`),
			create: (input: PaymentCreateInput) =>
				apiRequest<{ payment: SupplierPaymentDetail; replayed: boolean }>(
					"/api/payables/payments",
					{ method: "POST", body: input },
				),
			void: (id: string, input: PaymentVoidInput) =>
				apiRequest<{ payment: SupplierPaymentDetail }>(`/api/payables/payments/${id}/void`, {
					method: "POST",
					body: input,
				}),
		},
		balances: {
			list: (query: { branchId?: string } = {}) =>
				apiRequest<SupplierBalanceResult>("/api/payables/balances", { query }),
		},
		aging: {
			get: (query: PayablesAgingQuery = {}) =>
				apiRequest<PayablesAgingResult>("/api/payables/aging", { query }),
		},
	},

	transfers: {
		list: (query: TransferListQuery = {}) =>
			apiRequest<{ transfers: Transfer[]; total: number; branchId: string | null }>(
				"/api/transfers",
				{ query },
			),
		get: (id: string) => apiRequest<{ transfer: Transfer }>(`/api/transfers/${id}`),
		create: (input: TransferCreateInput) =>
			apiRequest<{ transfer: Transfer }>("/api/transfers", { method: "POST", body: input }),
		update: (id: string, input: { note?: string | null }) =>
			apiRequest<{ transfer: Transfer }>(`/api/transfers/${id}`, {
				method: "PATCH",
				body: input,
			}),
		replaceLines: (id: string, lines: TransferCreateInput["lines"]) =>
			apiRequest<{ transfer: Transfer }>(`/api/transfers/${id}/lines`, {
				method: "PUT",
				body: { lines },
			}),
		cancel: (id: string) =>
			apiRequest<{ ok: true }>(`/api/transfers/${id}/cancel`, { method: "POST" }),
		dispatch: (id: string, lines: { productId: string; quantityDispatched: number }[]) =>
			apiRequest<{ transfer: Transfer }>(`/api/transfers/${id}/dispatch`, {
				method: "POST",
				body: { lines },
			}),
		receive: (id: string, lines: { productId: string; quantityReceived: number }[]) =>
			apiRequest<{ transfer: Transfer }>(`/api/transfers/${id}/receive`, {
				method: "POST",
				body: { lines },
			}),
		shortClose: (id: string, note: string) =>
			apiRequest<{ transfer: Transfer }>(`/api/transfers/${id}/short-close`, {
				method: "POST",
				body: { note },
			}),
	},

	counts: {
		list: (query: CountListQuery = {}) =>
			apiRequest<{ counts: StockCount[]; total: number; branchId: string | null }>("/api/counts", {
				query,
			}),
		get: (id: string) => apiRequest<{ count: StockCount }>(`/api/counts/${id}`),
		create: (input: CountCreateInput) =>
			apiRequest<{ count: StockCount }>("/api/counts", { method: "POST", body: input }),
		updateLines: (id: string, lines: { productId: string; countedQty: number | null }[]) =>
			apiRequest<{ count: StockCount }>(`/api/counts/${id}/lines`, {
				method: "PATCH",
				body: { lines },
			}),
		post: (id: string) =>
			apiRequest<{ count: StockCount }>(`/api/counts/${id}/post`, { method: "POST" }),
		cancel: (id: string) =>
			apiRequest<{ ok: true }>(`/api/counts/${id}/cancel`, { method: "POST" }),
	},
}
