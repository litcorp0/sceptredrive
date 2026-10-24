/**
 * `suppliers` — the supplier master: identity and payment terms, the bank/MoMo destinations used
 * to pay them, and the products they supply with the last cost recorded on purchase invoices.
 *
 * Migration note (Phase 8): the section was 1,523 lines of components under
 * `components/suppliers/`. The supplier master now lives here; the section layout is a page
 * (`SuppliersLayout`), and each of the three supplier routes renders one page and nothing else
 * (decisions D6, D9 — a move, not a rewrite). The `suppliers/invoices`, `suppliers/payments` and
 * `suppliers/aging` routes are payables screens (route path ≠ module ownership) and stay where
 * they are until Plan 11.
 *
 * The API keys keep the pre-Phase-8 roots (`["suppliers"]`, `["supplier"]`) byte for byte, because
 * every lifecycle, payment-detail and supplied-product mutation invalidates them by prefix, and
 * the payables screens embed the supplier read. Money stays integer minor units and formatting
 * stays in `lib/format`.
 *
 * Payment destinations are sensitive: the list renders the masked account through
 * `utils/payment-detail`, the API's masking is never undone, and no account number reaches a log
 * or a query key.
 *
 * The barrel is the only entry point. Payables reads `getSupplier`/`listSuppliers` from here and
 * the shared combobox lives in `components/common` — neither may reach into `components/`.
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
export { PaymentDetailDialog } from "./components/payment-detail-dialog"
export { PaymentDetailsPanel } from "./components/payment-details-panel"
export { SupplierFormDialog } from "./components/supplier-form-dialog"
export {
	ArchiveSupplierDialog,
	ReactivateSupplierButton,
} from "./components/supplier-lifecycle-dialogs"
export { SupplierList } from "./components/supplier-list"
export { SupplierOverview } from "./components/supplier-overview"
export { SupplierProductDialog } from "./components/supplier-product-dialog"
export { SupplierProductsPanel } from "./components/supplier-products-panel"
export { SupplierDetailPage } from "./pages/supplier-detail-page"
export { SuppliersLayout } from "./pages/suppliers-layout"
export { SuppliersPage } from "./pages/suppliers-page"
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
export { SupplierStatusBadge } from "./ui/supplier-status-badge"
