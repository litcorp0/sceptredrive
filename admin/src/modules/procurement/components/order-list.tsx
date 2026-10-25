import { formatDay } from "@sceptre/shared"
import { Link } from "@tanstack/react-router"
import { Pagination } from "#/components/common/pagination"
import { StatusBadge } from "#/components/common/status-badge"
import { TableMessage } from "#/components/common/table-message"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { formatGhs } from "#/lib/format"
import type { OrderListRow } from "../types"
import { OrderStatusBadge } from "../ui/order-status-badge"

/**
 * The order table. Presentational: filters, the branch and paging are the page's state, and every
 * row value is the API's (`goodsValueMinor`, `receivedQuantity`, `orderedQuantity`).
 */
export function OrderList({
	orders,
	isLoading,
	isError,
	canSelectBranch,
	total,
	limit,
	offset,
	onOffsetChange,
	emptyMessage = "No purchase orders match these filters.",
}: {
	orders: OrderListRow[]
	isLoading: boolean
	isError: boolean
	canSelectBranch: boolean
	total: number
	limit: number
	offset: number
	onOffsetChange: (offset: number) => void
	emptyMessage?: string
}) {
	const columns = canSelectBranch ? 8 : 7

	return (
		<div>
			<div className="rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-32">Number</TableHead>
							<TableHead>Supplier</TableHead>
							{canSelectBranch ? <TableHead className="w-24">Branch</TableHead> : null}
							<TableHead className="w-40">Status</TableHead>
							<TableHead className="w-32">Expected</TableHead>
							<TableHead className="w-32 text-right">Goods value</TableHead>
							<TableHead className="w-32">Received</TableHead>
							<TableHead className="w-36">Approval</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading ? (
							<TableMessage colSpan={columns} state="loading" rows={6}>
								Loading purchase orders…
							</TableMessage>
						) : isError ? (
							<TableMessage colSpan={columns} tone="error">
								Couldn't load purchase orders.
							</TableMessage>
						) : orders.length === 0 ? (
							<TableMessage colSpan={columns}>{emptyMessage}</TableMessage>
						) : (
							orders.map((order) => (
								<TableRow key={order.id}>
									<TableCell>
										<Link
											to="/procurement/orders/$orderId"
											params={{ orderId: order.id }}
											className="font-mono text-xs font-medium hover:underline"
										>
											{order.number}
										</Link>
									</TableCell>
									<TableCell className="max-w-48">
										<Link
											to="/suppliers/$supplierId"
											params={{ supplierId: order.supplierId }}
											className="block truncate hover:underline"
										>
											{order.supplierName}
										</Link>
									</TableCell>
									{canSelectBranch ? (
										<TableCell className="text-muted-foreground">{order.branchCode}</TableCell>
									) : null}
									<TableCell>
										<OrderStatusBadge status={order.status} />
									</TableCell>
									<TableCell className="text-muted-foreground">
										{order.expectedDate ? formatDay(order.expectedDate) : "—"}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatGhs(order.goodsValueMinor)}
									</TableCell>
									<TableCell className="text-muted-foreground tabular-nums">
										{order.receivedQuantity} of {order.orderedQuantity}
									</TableCell>
									<TableCell>
										{order.status === "PENDING_APPROVAL" ? (
											<StatusBadge variant="warn">Awaiting decision</StatusBadge>
										) : (
											<span className="text-muted-foreground">—</span>
										)}
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			<Pagination total={total} limit={limit} offset={offset} onOffsetChange={onOffsetChange} />
		</div>
	)
}
