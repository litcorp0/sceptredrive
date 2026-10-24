import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type {
	CustomerCreateInput,
	CustomerDetail,
	CustomerListQuery,
	CustomerListRow,
	CustomerSearchResult,
	CustomerUpdateInput,
} from "../types"
import { customerKeys } from "./keys"

/**
 * `GET /api/customers` — the list, and the console's only customer search: the API matches a name
 * or a phone suffix once the term reaches two characters. It is scoped by the branch the session
 * resolved, which is why the query carries the filter block.
 */
export function customerListOptions(query: CustomerListQuery = {}) {
	return queryOptions({
		queryKey: customerKeys.list(query),
		queryFn: () => apiRequest<CustomerSearchResult>("/api/customers", { query }),
	})
}

/** `GET /api/customers/:id` — identity plus the per-branch credit profiles and loyalty summary. */
export function customerDetailOptions(customerId: string) {
	return queryOptions({
		queryKey: customerKeys.byId(customerId),
		queryFn: () => apiRequest<CustomerDetail>(`/api/customers/${customerId}`),
	})
}

export function createCustomer(input: CustomerCreateInput) {
	return apiRequest<{ customer: CustomerListRow }>("/api/customers", {
		method: "POST",
		body: input,
	})
}

export function updateCustomer(customerId: string, input: CustomerUpdateInput) {
	return apiRequest<{ customer: CustomerListRow }>(`/api/customers/${customerId}`, {
		method: "PATCH",
		body: input,
	})
}

export function archiveCustomer(customerId: string, note?: string) {
	return apiRequest<{ customer: CustomerListRow }>(`/api/customers/${customerId}/archive`, {
		method: "POST",
		body: { note: note || undefined },
	})
}

export function reactivateCustomer(customerId: string) {
	return apiRequest<{ customer: CustomerListRow }>(`/api/customers/${customerId}/reactivate`, {
		method: "POST",
	})
}

export function anonymizeCustomer(customerId: string, note?: string) {
	return apiRequest<{ customer: CustomerListRow }>(`/api/customers/${customerId}/anonymize`, {
		method: "POST",
		body: { note: note || undefined },
	})
}
