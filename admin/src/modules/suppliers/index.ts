/**
 * `suppliers` — the supplier master: identity and payment terms, the bank/MoMo destinations used
 * to pay them, and the products they supply with the last cost recorded on purchase invoices.
 *
 * The API keys keep the pre-Phase-8 roots (`["suppliers"]`, `["supplier"]`) byte for byte, because
 * every lifecycle, payment-detail and supplied-product mutation invalidates them by prefix, and
 * the payables screens embed the supplier read. Money stays integer minor units and formatting
 * stays in `lib/format`.
 */

export { supplierKeys } from "./api/keys"
export {
	addSupplierPaymentDetail,
	addSupplierProduct,
	archiveSupplier,
	createSupplier,
	getSupplier,
	listSuppliers,
	reactivateSupplier,
	removeSupplierProduct,
	supplierDetailOptions,
	supplierListOptions,
	updateSupplier,
	updateSupplierPaymentDetail,
	updateSupplierProduct,
} from "./api/suppliers"
export type {
	PaymentDetailInput,
	PaymentDetailUpdateInput,
	Supplier,
	SupplierArchiveInput,
	SupplierCreateInput,
	SupplierDetail,
	SupplierListQuery,
	SupplierListResult,
	SupplierListRow,
	SupplierMomoNetwork,
	SupplierPaymentDetailMethod,
	SupplierPaymentDetailView,
	SupplierProductInput,
	SupplierProductMapping,
	SupplierProductUpdateInput,
	SupplierStatus,
	SupplierUpdateInput,
} from "./types"
