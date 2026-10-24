/**
 * `inventory` — stock levels, the movement ledger, goods receipts, adjustments, thresholds,
 * branch transfers, and stock counts.
 *
 * Migration note (Phase 8): the section was 2,281 route lines across twelve files and ten
 * components under `components/inventory/`. The section layout is now a page (`InventoryLayout`),
 * every route renders one page and nothing else, and the three `api` groups live beside the
 * screens that call them (decisions D6, D9 — a move, not a rewrite).
 *
 * The API keys keep the pre-Phase-8 roots (`["inventory-stock"]`, `["inventory-movements"]`,
 * `["inventory-receipts"]`, `["inventory-receipt"]`, `["inventory-thresholds"]`,
 * `["receipt-invoice"]`, `["transfers"]`, `["transfer"]`, `["counts"]`, `["count"]`) because every
 * dialog invalidates them by prefix, from several places, by name. Money stays integer minor units
 * and formatting stays in `lib/format`.
 */
export {
	cancelCount,
	countDetailOptions,
	countListOptions,
	createCount,
	postCount,
	updateCountLines,
} from "./api/counts"
export {
	createAdjustment,
	createReceipt,
	getReceipt,
	listReceipts,
	movementListOptions,
	receiptDetailOptions,
	receiptInvoiceOptions,
	receiptListOptions,
	removeThreshold,
	setThreshold,
	stockDetailOptions,
	stockListOptions,
	thresholdListOptions,
} from "./api/inventory"
export { countKeys, inventoryKeys, transferKeys } from "./api/keys"
export {
	cancelTransfer,
	createTransfer,
	dispatchTransfer,
	receiveTransfer,
	replaceTransferLines,
	shortCloseTransfer,
	transferDetailOptions,
	transferListOptions,
	updateTransfer,
} from "./api/transfers"
export { AdjustDialog } from "./components/adjust-dialog"
export { EditTransferDialog } from "./components/edit-transfer-dialog"
export { ReceiveDialog } from "./components/receive-dialog"
export { ShortCloseDialog } from "./components/short-close-dialog"
export { SupplierPicker } from "./components/supplier-picker"
export { ThresholdDialog } from "./components/threshold-dialog"
export {
	newTransferLine,
	type TransferLineDraft,
	TransferLinesEditor,
} from "./components/transfer-lines-editor"
export { TransferQuantityDialog } from "./components/transfer-quantity-dialog"
export { TransferStatusBadge } from "./components/transfer-status-badge"
export { InventoryLayout } from "./pages/inventory-layout"
export { ReceiptDetailPage } from "./pages/receipt-detail-page"
export { ReceiptsPage } from "./pages/receipts-page"
export { StockDetailPage } from "./pages/stock-detail-page"
export { StockPage } from "./pages/stock-page"
export { TransferDetailPage } from "./pages/transfer-detail-page"
export { TransferNewPage } from "./pages/transfer-new-page"
export { TransfersPage } from "./pages/transfers-page"
export type {
	AdjustmentCreateInput,
	AdjustmentReason,
	CountCreateInput,
	CountListQuery,
	InventoryReceipt,
	InventoryReceiptLine,
	MovementListQuery,
	MovementRow,
	ReceiptCreateInput,
	ReceiptListQuery,
	StockCount,
	StockCountLine,
	StockCountStatus,
	StockDetail,
	StockListQuery,
	StockMovementType,
	StockRow,
	StockThreshold,
	ThresholdInput,
	Transfer,
	TransferCreateInput,
	TransferLine,
	TransferListQuery,
	TransferStatus,
} from "./types"
