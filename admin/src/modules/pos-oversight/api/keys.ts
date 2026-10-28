import type {
	ConflictListQuery,
	OversightRefundsQuery,
	OversightSalesQuery,
	OversightShiftsQuery,
} from "../types"

/**
 * Keys the oversight module owns. A filter change is a different read; a detail is keyed
 * by its id so an invalidation cannot cross documents.
 */
export const posKeys = {
	all: ["pos-oversight"] as const,
	sales: (query: OversightSalesQuery) => [...posKeys.all, "sales", query] as const,
	sale: (id: string) => [...posKeys.all, "sale", id] as const,
	receipt: (id: string) => [...posKeys.all, "receipt", id] as const,
	refunds: (query: OversightRefundsQuery) => [...posKeys.all, "refunds", query] as const,
	refund: (id: string) => [...posKeys.all, "refund", id] as const,
	shifts: (query: OversightShiftsQuery) => [...posKeys.all, "shifts", query] as const,
	shift: (id: string) => [...posKeys.all, "shift", id] as const,
	conflicts: (query: ConflictListQuery) => [...posKeys.all, "conflicts", query] as const,
	conflict: (id: string) => [...posKeys.all, "conflict", id] as const,
}
