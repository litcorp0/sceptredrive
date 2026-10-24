import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type {
	PaymentDetailInput,
	PaymentDetailUpdateInput,
	Supplier,
	SupplierCreateInput,
	SupplierDetail,
	SupplierListQuery,
	SupplierListResult,
	SupplierPaymentDetailView,
	SupplierProductInput,
	SupplierProductMapping,
	SupplierProductUpdateInput,
	SupplierUpdateInput,
} from "../types"
import { supplierKeys } from "./keys"

/** `GET /api/suppliers` — the list, and the only supplier search (name or code, two characters). */
export function supplierListOptions(query: SupplierListQuery = {}) {
	return queryOptions({
		queryKey: supplierKeys.list(query),
		queryFn: () => listSuppliers(query),
	})
}

/** The bare fetcher, for callers that own their own key (the shared supplier combobox today). */
export function listSuppliers(query: SupplierListQuery = {}) {
	return apiRequest<SupplierListResult>("/api/suppliers", { query })
}

/** `GET /api/suppliers/:id` — the supplier, its payment details, and its supplied products. */
export function getSupplier(id: string) {
	return apiRequest<SupplierDetail>(`/api/suppliers/${id}`)
}

export function supplierDetailOptions(id: string) {
	return queryOptions({
		queryKey: supplierKeys.byId(id),
		queryFn: () => getSupplier(id),
	})
}

export function createSupplier(input: SupplierCreateInput) {
	return apiRequest<{ supplier: Supplier }>("/api/suppliers", {
		method: "POST",
		body: input,
	})
}

export function updateSupplier(id: string, input: SupplierUpdateInput) {
	return apiRequest<{ supplier: Supplier }>(`/api/suppliers/${id}`, {
		method: "PATCH",
		body: input,
	})
}

export function archiveSupplier(id: string, note?: string) {
	return apiRequest<{ supplier: Supplier }>(`/api/suppliers/${id}/archive`, {
		method: "POST",
		body: { note: note || undefined },
	})
}

export function reactivateSupplier(id: string) {
	return apiRequest<{ supplier: Supplier }>(`/api/suppliers/${id}/reactivate`, {
		method: "POST",
	})
}

export function addSupplierPaymentDetail(id: string, input: PaymentDetailInput) {
	return apiRequest<{ paymentDetail: SupplierPaymentDetailView }>(
		`/api/suppliers/${id}/payment-details`,
		{
			method: "POST",
			body: input,
		},
	)
}

export function updateSupplierPaymentDetail(
	id: string,
	detailId: string,
	input: PaymentDetailUpdateInput,
) {
	return apiRequest<{ paymentDetail: SupplierPaymentDetailView }>(
		`/api/suppliers/${id}/payment-details/${detailId}`,
		{ method: "PATCH", body: input },
	)
}

export function addSupplierProduct(id: string, input: SupplierProductInput) {
	return apiRequest<{ mapping: SupplierProductMapping }>(`/api/suppliers/${id}/products`, {
		method: "POST",
		body: input,
	})
}

export function updateSupplierProduct(
	id: string,
	mappingId: string,
	input: SupplierProductUpdateInput,
) {
	return apiRequest<{ mapping: SupplierProductMapping }>(
		`/api/suppliers/${id}/products/${mappingId}`,
		{ method: "PATCH", body: input },
	)
}

export function removeSupplierProduct(id: string, mappingId: string) {
	return apiRequest<{ ok: true }>(`/api/suppliers/${id}/products/${mappingId}`, {
		method: "DELETE",
	})
}
