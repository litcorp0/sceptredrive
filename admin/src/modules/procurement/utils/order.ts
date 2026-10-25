import type { CsvColumn, PurchaseOrderStatus } from "@sceptre/shared"
import { toCsv } from "@sceptre/shared"
import type { StatusVariant } from "#/components/common/status-badge"
import type { OrderDetail, OrderLine, ReturnStatus } from "../types"

/**
 * The words a human reads for an order, in one place.
 *
 * Status is never conveyed by colour alone: every badge renders the label from here, and the
 * variant is only the tint behind it.
 */
const STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
	DRAFT: "Draft",
	PENDING_APPROVAL: "Awaiting approval",
	APPROVED: "Approved",
	REJECTED: "Rejected",
	SENT: "Sent",
	PARTIALLY_RECEIVED: "Partially received",
	RECEIVED: "Received",
	CLOSED: "Closed",
	CANCELLED: "Cancelled",
}

const STATUS_TONES: Record<PurchaseOrderStatus, StatusVariant> = {
	DRAFT: "muted",
	PENDING_APPROVAL: "warn",
	APPROVED: "info",
	REJECTED: "danger",
	SENT: "info",
	PARTIALLY_RECEIVED: "warn",
	RECEIVED: "ok",
	CLOSED: "muted",
	CANCELLED: "danger",
}

export function statusLabel(status: PurchaseOrderStatus): string {
	return STATUS_LABELS[status]
}

export function statusTone(status: PurchaseOrderStatus): StatusVariant {
	return STATUS_TONES[status]
}

const RETURN_STATUS_LABELS: Record<ReturnStatus, string> = {
	DRAFT: "Draft",
	POSTED: "Posted",
	CANCELLED: "Cancelled",
}

export function returnStatusLabel(status: ReturnStatus): string {
	return RETURN_STATUS_LABELS[status]
}

export function returnStatusTone(status: ReturnStatus): StatusVariant {
	if (status === "POSTED") return "ok"
	if (status === "CANCELLED") return "danger"
	return "muted"
}

/** `SKU — name`, or the name alone when a product has no SKU. */
export function formatOrderLine(line: Pick<OrderLine, "sku" | "name">): string {
	return line.sku ? `${line.sku} — ${line.name}` : line.name
}

/** One row per order line; money stays integer pesewas so a spreadsheet can total it. */
export interface OrderCsvRow {
	line: number
	sku: string
	product: string
	ordered: number
	received: number
	outstanding: number
	unitCostPesewas: number
	lineTotalPesewas: number
}

const ORDER_CSV_COLUMNS: CsvColumn<OrderCsvRow>[] = [
	{ key: "line", header: "Line" },
	{ key: "sku", header: "SKU" },
	{ key: "product", header: "Product" },
	{ key: "ordered", header: "Ordered" },
	{ key: "received", header: "Received" },
	{ key: "outstanding", header: "Outstanding" },
	{ key: "unitCostPesewas", header: "Unit cost (pesewas)" },
	{ key: "lineTotalPesewas", header: "Line total (pesewas)" },
]

export function orderCsvRows(detail: OrderDetail): OrderCsvRow[] {
	return detail.lines.map((line) => ({
		line: line.lineNumber,
		sku: line.sku,
		product: line.name,
		ordered: line.quantity,
		received: line.receivedQuantity,
		outstanding: line.outstandingQuantity,
		unitCostPesewas: line.unitCostMinor,
		lineTotalPesewas: line.lineTotalMinor,
	}))
}

/**
 * The printable/exportable line table.
 *
 * `toCsv` from `@sceptre/shared` owns the formula-injection escaping; a second writer here would
 * be a second escaping rule waiting to disagree.
 */
export function orderCsv(detail: OrderDetail): string {
	return toCsv(ORDER_CSV_COLUMNS, orderCsvRows(detail))
}
