/**
 * `procurement` — purchase orders, receiving against them, supplier returns, the approval queue
 * and the decisions that gate them (Phase 11).
 *
 * The section is online-only: the POS never sees an order, a receipt or a credit note, so nothing
 * here reaches `desktop/**` or the sync streams (00-CONTEXT D14). Money stays integer minor units
 * and every state the screen can offer comes from the server's `canApply`/`canDecide`, never a
 * client guess about the lifecycle.
 *
 * Two reads cross a module boundary and both are deliberate:
 *
 * - `procurement → inventory` for a receipt's lines when a return is raised (`getReceipt`,
 *   `receiptListOptions`, `inventoryKeys`); a receipt is inventory's document.
 * - `catalog → procurement` for the pending product submissions the console must decide. The
 *   approvals fetchers live here because approvals are procurement's queue; the catalogue panel
 *   imports this barrel, never `api/approvals`.
 *
 * The barrel is the only entry point.
 */
export {
	approvalDetailOptions,
	approvalListOptions,
	decideApproval,
	getApproval,
	listApprovals,
	withdrawApproval,
} from "./api/approvals"
export { approvalKeys, orderKeys, returnKeys } from "./api/keys"
export {
	cancelOrder,
	closeOrder,
	createOrder,
	createOrderFromSuggestions,
	getOrder,
	listMatchableOrders,
	listOrders,
	matchableOrderOptions,
	orderDetailOptions,
	orderListOptions,
	receiveOrder,
	sendOrder,
	submitOrder,
	updateOrder,
} from "./api/orders"
export {
	cancelReturn,
	createReturn,
	getReturn,
	listReturns,
	postReturn,
	returnDetailOptions,
	returnListOptions,
} from "./api/returns"
export { ApprovalPanel } from "./components/approval-panel"
export { OrderActions } from "./components/order-actions"
export { OrderForm } from "./components/order-form"
export { OrderLinesEditor } from "./components/order-lines-editor"
export { OrderList } from "./components/order-list"
export { OrderPrintSheet } from "./components/order-print-sheet"
export { OrderReturns } from "./components/order-returns"
export { ReceiveOrderDialog } from "./components/receive-dialog"
export { ReturnDialog } from "./components/return-dialog"
export { OrderDetailPage } from "./pages/order-detail-page"
export { OrderNewPage } from "./pages/order-new-page"
export { OrdersPage } from "./pages/orders-page"
export { ProcurementLayout } from "./pages/procurement-layout"
export type {
	ApprovalDecisionInput,
	ApprovalDetail,
	ApprovalListQuery,
	ApprovalListResult,
	ApprovalRow,
	ApprovalSubject,
	MatchableOrder,
	OrderApprovalSummary,
	OrderCancelInput,
	OrderCloseInput,
	OrderCreateInput,
	OrderDetail,
	OrderFromSuggestionsInput,
	OrderLine,
	OrderLineInput,
	OrderListQuery,
	OrderListResult,
	OrderListRow,
	OrderRow,
	OrderStatus,
	OrderUpdateInput,
	OverReceiptReason,
	ReceiveLineInput,
	ReceiveOrderInput,
	ReceiveOrderResult,
	ReceivedReceipt,
	ReturnCreateInput,
	ReturnDetail,
	ReturnLine,
	ReturnListQuery,
	ReturnListResult,
	ReturnListRow,
	ReturnRow,
	ReturnStatus,
} from "./types"
export { OrderStatusBadge } from "./ui/order-status-badge"
export {
	formatOrderLine,
	orderCsv,
	orderCsvRows,
	returnStatusLabel,
	returnStatusTone,
	statusLabel,
	statusTone,
} from "./utils/order"
