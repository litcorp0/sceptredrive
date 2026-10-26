import { formatDay } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { formatGhs } from "#/lib/format"
// The receipt is inventory's document; this card only lists the ones that fulfil the order.
import { receiptListOptions } from "#/modules/inventory"
import type { OrderDetail } from "../types"

/**
 * The deliveries recorded against one order.
 *
 * The list is filtered by `purchaseOrderId` on the server, so the card cannot show a receipt that
 * belongs to another order or branch. A receipt opens its own inventory screen, where the ledger
 * effect and the supplier invoice live.
 */
export function OrderReceipts({ order }: { order: OrderDetail }) {
	const receiptsQuery = useQuery(
		receiptListOptions({
			branchId: order.order.branchId,
			purchaseOrderId: order.order.id,
			limit: 50,
		}),
	)

	const receipts = receiptsQuery.data?.receipts ?? []

	return (
		<Card>
			<CardHeader>
				<CardTitle>Receipts</CardTitle>
				<CardDescription>
					What actually arrived against this order, each with the stock movement it posted.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{receiptsQuery.isLoading ? (
					<p className="text-sm text-muted-foreground">Loading receipts…</p>
				) : receiptsQuery.isError ? (
					<p role="alert" className="text-sm text-destructive">
						Couldn't load the receipts for this order.
					</p>
				) : receipts.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						Nothing has arrived against this order yet.
					</p>
				) : (
					<div className="overflow-x-auto rounded-lg border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Receipt</TableHead>
									<TableHead>Received</TableHead>
									<TableHead className="text-right">Lines</TableHead>
									<TableHead className="text-right">Cost</TableHead>
									<TableHead className="w-16" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{receipts.map((receipt) => (
									<TableRow key={receipt.id}>
										<TableCell className="font-mono text-sm">{receipt.number}</TableCell>
										<TableCell>{formatDay(receipt.createdAt)}</TableCell>
										<TableCell className="text-right tabular-nums">{receipt.lineCount}</TableCell>
										<TableCell className="text-right tabular-nums">
											{formatGhs(receipt.totalCostMinor)}
										</TableCell>
										<TableCell className="text-right">
											<Link
												to="/inventory/receipts/$receiptId"
												params={{ receiptId: receipt.id }}
												className="text-sm underline-offset-4 hover:underline"
											>
												Open
											</Link>
										</TableCell>
									</TableRow>
								))}
							</TableBody>
						</Table>
					</div>
				)}
			</CardContent>
		</Card>
	)
}
