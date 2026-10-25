import { formatDay } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { ArrowLeftIcon, DownloadIcon, PencilIcon, PrinterIcon } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "#/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { ApiError } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"
import { formatGhs } from "#/lib/format"
import { hasPermission } from "#/lib/role"
import { orderDetailOptions } from "../api/orders"
import { ApprovalPanel } from "../components/approval-panel"
import { OrderActions } from "../components/order-actions"
import { OrderForm } from "../components/order-form"
import { OrderPrintSheet } from "../components/order-print-sheet"
import { OrderStatusBadge } from "../ui/order-status-badge"
import { orderCsv } from "../utils/order"

const authenticatedRoute = getRouteApi("/_authenticated")
const orderDetailRoute = getRouteApi("/_authenticated/procurement/orders/$orderId")

function downloadCsv(filename: string, content: string) {
	const blob = new Blob([content], { type: "text/csv;charset=utf-8" })
	const url = URL.createObjectURL(blob)
	const anchor = document.createElement("a")
	anchor.href = url
	anchor.download = filename
	document.body.append(anchor)
	anchor.click()
	anchor.remove()
	URL.revokeObjectURL(url)
}

/**
 * One purchase order: its lines, the approval decision, the lifecycle actions and the printable
 * sheet.
 *
 * Every action comes from `canApply`; the money is the API's `goodsValueMinor`, formatted and never
 * recomputed. The CSV is mapped from the same line payload through `toCsv`, so a spreadsheet gets
 * the escaped cells and raw pesewas without a second writer.
 */
export function OrderDetailPage() {
	const { orderId } = orderDetailRoute.useParams()
	const { session } = authenticatedRoute.useRouteContext()
	const { branches } = useBranch()
	const [editing, setEditing] = useState(false)

	const orderQuery = useQuery(orderDetailOptions(orderId))
	const detail = orderQuery.data
	const order = detail?.order

	if (orderQuery.isPending) {
		return <p className="text-sm text-muted-foreground">Loading purchase order…</p>
	}

	if (orderQuery.isError || !detail || !order) {
		const status = orderQuery.error instanceof ApiError ? orderQuery.error.status : 0
		return (
			<div>
				<BackLink />
				<p className="text-sm text-muted-foreground">
					{status === 403
						? "You don't have permission to view this order."
						: status === 404
							? "Purchase order not found."
							: "Couldn't load this purchase order."}
				</p>
			</div>
		)
	}

	const branchName = branches.find((branch) => branch.id === order.branchId)?.name ?? "Branch"
	const canEdit =
		order.status === "DRAFT" && hasPermission(session.user.role, "procurement.create")

	return (
		<section>
			<div className="print:hidden">
				<BackLink />

				<div className="mb-4 flex flex-wrap items-start justify-between gap-3">
					<div>
						<div className="flex flex-wrap items-center gap-2">
							<h2 className="font-mono text-lg font-semibold tracking-tight">{order.number}</h2>
							<OrderStatusBadge status={order.status} />
						</div>
						<p className="mt-1 text-sm text-muted-foreground">
							<Link
								to="/suppliers/$supplierId"
								params={{ supplierId: order.supplierId }}
								className="hover:underline"
							>
								{order.supplierName}
							</Link>{" "}
							· {order.supplierCode} · {branchName}
						</p>
						<p className="mt-0.5 text-sm text-muted-foreground">
							Expected {order.expectedDate ? formatDay(order.expectedDate) : "—"} · raised{" "}
							{formatDay(order.createdAt)}
							{order.requestedBy ? ` by ${order.requestedBy}` : ""}
						</p>
						<p className="mt-1 text-sm">
							Goods value (ex-tax):{" "}
							<span className="font-medium tabular-nums">
								{formatGhs(detail.goodsValueMinor)}
							</span>
						</p>
					</div>

					<div className="flex flex-wrap items-center gap-2">
						<Button variant="outline" size="sm" onClick={() => window.print()}>
							<PrinterIcon className="size-4" aria-hidden="true" />
							Print
						</Button>
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								downloadCsv(`${order.number}.csv`, orderCsv(detail))
								toast.success("Order CSV downloaded", {
									description: "Amounts are raw pesewas.",
								})
							}}
						>
							<DownloadIcon className="size-4" aria-hidden="true" />
							Export CSV
						</Button>
						{canEdit && !editing ? (
							<Button variant="outline" size="sm" onClick={() => setEditing(true)}>
								<PencilIcon className="size-4" aria-hidden="true" />
								Edit draft
							</Button>
						) : null}
					</div>
				</div>

				{order.status === "CANCELLED" ? (
					<p className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
						Cancelled{order.cancelledAt ? ` on ${formatDay(order.cancelledAt)}` : ""}
						{order.cancelledBy ? ` by ${order.cancelledBy}` : ""}
						{order.cancelReason ? ` — ${order.cancelReason}` : ""}.
					</p>
				) : null}
				{order.status === "CLOSED" ? (
					<p className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
						Closed{order.closedAt ? ` on ${formatDay(order.closedAt)}` : ""}
						{order.closedBy ? ` by ${order.closedBy}` : ""}
						{order.closeNote ? ` — ${order.closeNote}` : ""}.
					</p>
				) : null}
				{order.sentAt ? (
					<p className="mb-3 text-sm text-muted-foreground">
						Sent{order.sentBy ? ` by ${order.sentBy}` : ""} on {formatDay(order.sentAt)}.
					</p>
				) : null}

				{editing ? (
					<OrderForm
						key={order.updatedAt}
						mode="edit"
						order={detail}
						onSaved={() => setEditing(false)}
						onCancel={() => setEditing(false)}
					/>
				) : (
					<>
						<div className="mb-4">
							<OrderActions order={detail} />
						</div>

						<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
							<div className="grid gap-4">
								<Card>
									<CardHeader>
										<CardTitle>Lines</CardTitle>
										<CardDescription>
											Ordered, previously received and what is still outstanding. The API computes
											all three.
										</CardDescription>
									</CardHeader>
									<CardContent>
										<div className="overflow-x-auto rounded-lg border">
											<Table>
												<TableHeader>
													<TableRow>
														<TableHead className="w-10 text-right">#</TableHead>
														<TableHead>Product</TableHead>
														<TableHead className="w-20 text-right">Ordered</TableHead>
														<TableHead className="w-24 text-right">Received</TableHead>
														<TableHead className="w-24 text-right">Outstanding</TableHead>
														<TableHead className="w-28 text-right">Unit cost</TableHead>
														<TableHead className="w-28 text-right">Line total</TableHead>
													</TableRow>
												</TableHeader>
												<TableBody>
													{detail.lines.map((line) => (
														<TableRow key={line.id}>
															<TableCell className="text-right tabular-nums">
																{line.lineNumber}
															</TableCell>
															<TableCell>
																<p className="font-medium">{line.name}</p>
																<p className="font-mono text-xs text-muted-foreground">
																	{line.sku}
																</p>
															</TableCell>
															<TableCell className="text-right tabular-nums">
																{line.quantity}
															</TableCell>
															<TableCell className="text-right tabular-nums">
																{line.receivedQuantity}
															</TableCell>
															<TableCell className="text-right tabular-nums">
																{line.outstandingQuantity}
															</TableCell>
															<TableCell className="text-right tabular-nums">
																{formatGhs(line.unitCostMinor)}
															</TableCell>
															<TableCell className="text-right tabular-nums">
																{formatGhs(line.lineTotalMinor)}
															</TableCell>
														</TableRow>
													))}
												</TableBody>
											</Table>
										</div>

										{order.note ? (
											<p className="mt-3 text-sm text-muted-foreground">Note: {order.note}</p>
										) : null}
									</CardContent>
								</Card>
							</div>

							<div className="grid content-start gap-4">
								<ApprovalPanel detail={detail} role={session.user.role} />
							</div>
						</div>
					</>
				)}
			</div>

			<OrderPrintSheet detail={detail} branchName={branchName} />
		</section>
	)
}

function BackLink() {
	return (
		<Link
			to="/procurement/orders"
			className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
		>
			<ArrowLeftIcon className="size-4" aria-hidden="true" />
			Purchase orders
		</Link>
	)
}
