import { formatDay } from "@sceptre/shared"
import { formatGhs } from "#/lib/format"
import type { OrderDetail } from "../types"
import { OrderStatusBadge } from "../ui/order-status-badge"
import { formatOrderLine } from "../utils/order"

/**
 * The printable purchase order.
 *
 * It is rendered in the page (never a portal) and hidden on screen with `hidden print:block`; the
 * shell already hides the sidebar, the topbar and the page's own controls in print, so the browser
 * preview shows the order and nothing else. No new stylesheet.
 */
export function OrderPrintSheet({
	detail,
	branchName,
}: {
	detail: OrderDetail
	branchName: string
}) {
	const { order, lines } = detail

	return (
		<div className="hidden print:block">
			<div className="mb-6 flex items-start justify-between gap-6">
				<div>
					<p className="text-xs font-medium tracking-[0.08em] uppercase">Sceptre Drive</p>
					<h1 className="mt-1 font-display text-2xl tracking-[-0.015em]">Purchase order</h1>
					<p className="mt-1 font-mono text-sm">{order.number}</p>
					<p className="mt-1 text-sm text-muted-foreground">{branchName}</p>
				</div>
				<div className="text-right text-sm">
					<OrderStatusBadge status={order.status} />
					<p className="mt-2">
						Raised {formatDay(order.createdAt)}
						{order.requestedBy ? ` by ${order.requestedBy}` : ""}
					</p>
					<p className="text-muted-foreground">
						Expected {order.expectedDate ? formatDay(order.expectedDate) : "—"}
					</p>
				</div>
			</div>

			<div className="mb-6 grid grid-cols-2 gap-6 text-sm">
				<div>
					<p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
						Supplier
					</p>
					<p className="mt-1 font-medium">{order.supplierName}</p>
					<p className="font-mono text-xs text-muted-foreground">{order.supplierCode}</p>
				</div>
				<div className="text-right">
					<p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
						Goods value (ex-tax)
					</p>
					<p className="mt-1 font-display text-xl tabular-nums">
						{formatGhs(detail.goodsValueMinor)}
					</p>
				</div>
			</div>

			<table className="w-full border-collapse text-sm">
				<thead>
					<tr className="border-y border-border text-left">
						<th className="py-2 pr-3 font-medium">#</th>
						<th className="py-2 pr-3 font-medium">Product</th>
						<th className="py-2 pr-3 text-right font-medium">Qty</th>
						<th className="py-2 pr-3 text-right font-medium">Unit cost</th>
						<th className="py-2 text-right font-medium">Line total</th>
					</tr>
				</thead>
				<tbody>
					{lines.map((line) => (
						<tr key={line.id} className="border-b border-border align-top">
							<td className="py-2 pr-3 tabular-nums">{line.lineNumber}</td>
							<td className="py-2 pr-3">{formatOrderLine(line)}</td>
							<td className="py-2 pr-3 text-right tabular-nums">{line.quantity}</td>
							<td className="py-2 pr-3 text-right tabular-nums">
								{formatGhs(line.unitCostMinor)}
							</td>
							<td className="py-2 text-right tabular-nums">{formatGhs(line.lineTotalMinor)}</td>
						</tr>
					))}
				</tbody>
			</table>

			{order.note ? (
				<div className="mt-6 border-t border-border pt-3 text-sm">
					<p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
						Note
					</p>
					<p className="mt-1">{order.note}</p>
				</div>
			) : null}
		</div>
	)
}
