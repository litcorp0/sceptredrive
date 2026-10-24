import type { SupplierListQuery } from "../types"

/**
 * Every key the suppliers module owns.
 *
 * The roots are measured, not guessed: `["suppliers"]` for the list — which is also the supplier
 * search the shared combobox runs — and `["supplier"]` for one supplier's detail. They are two
 * roots on purpose: `["supplier"]` is not a prefix of `["suppliers"]`, so every lifecycle, payment
 * detail and supplied-product mutation invalidates both explicitly.
 *
 * There are no third and fourth roots here. `["supplier-invoices"]`, `["supplier-payments"]`,
 * `["supplier-balances"]` and the rest of the payables keys belong to `#/modules/payables`; the
 * supplier list reads the balance key through that module's `supplierBalancesOptions`.
 */
export const supplierKeys = {
	all: ["suppliers"] as const,
	detail: ["supplier"] as const,

	list: (query: SupplierListQuery) => [...supplierKeys.all, query] as const,
	byId: (supplierId: string) => [...supplierKeys.detail, supplierId] as const,
}
