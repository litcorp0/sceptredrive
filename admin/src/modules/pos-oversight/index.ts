/**
 * `pos-oversight` — the documents terminals produced, and the conflicts they raised.
 *
 * Four lists under one `/pos` section: sales, refunds, shifts and conflicts. Every
 * screen reads; the only write is a conflict resolution, which records a decision and
 * changes no sale, stock or ledger (P14-D13). The receipt copy is the API's rendered
 * document, never a browser recomputation, and says it is a copy (P14-D10).
 */
export { posKeys } from "./api/keys"
export {
	conflictOptions,
	conflictsOptions,
	receiptOptions,
	refundOptions,
	refundsOptions,
	resolveConflict,
	saleOptions,
	salesOptions,
	shiftOptions,
	shiftsOptions,
} from "./api/oversight"
export { ConflictSheet } from "./components/conflict-sheet"
export { ConflictsList } from "./components/conflicts-list"
export { OversightFilters } from "./components/oversight-filters"
export { ReceiptCopyDocument } from "./components/receipt-copy"
export { RefundsList } from "./components/refunds-list"
export { SalesList } from "./components/sales-list"
export { ShiftsList } from "./components/shifts-list"
export { PosOversightLayout } from "./pages/pos-oversight-layout"
export { PosOversightPage } from "./pages/pos-oversight-page"
export { RefundDetailPage } from "./pages/refund-detail-page"
export { SaleDetailPage } from "./pages/sale-detail-page"
export { ShiftDetailPage } from "./pages/shift-detail-page"
export type {
	ConflictDetail,
	ConflictList,
	ConflictListQuery,
	ConflictResolutionInput,
	ConflictRow,
	ConflictStatus,
	ConflictSubject,
	OversightRefundDetail,
	OversightRefundLine,
	OversightRefundsList,
	OversightRefundsQuery,
	OversightRefundTender,
	OversightSaleConflictRef,
	OversightSaleDetail,
	OversightSaleLine,
	OversightSaleRefundRef,
	OversightSaleRow,
	OversightSalesList,
	OversightSalesQuery,
	OversightSaleTender,
	OversightShiftDetail,
	OversightShiftRow,
	OversightShiftsList,
	OversightShiftsQuery,
	OversightVoidRow,
	OversightVoidSummary,
	ReceiptCopy,
	ReceiptEvatBlock,
	RefundTenderStatus,
	ShiftReportView,
	SyncConflictSeverity,
} from "./types"
export {
	POS_TABS,
	type PosSearch,
	type PosTab,
	posSearchDefaults,
	posSearchSchema,
	resolveTab,
} from "./utils/search"
