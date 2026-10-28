import { formatBranchLabel, formatCount, formatDateTime } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { PackageSearch, ShieldAlert } from "lucide-react"
import { EmptyState } from "#/components/common/empty-state"
import { Pagination } from "#/components/common/pagination"
import { StatusBadge } from "#/components/common/status-badge"
import { TableMessage } from "#/components/common/table-message"
import { Button } from "#/components/ui/button"
import { Card } from "#/components/ui/card"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { ApiError } from "#/lib/api"
import { formatGhs } from "#/lib/format"
import { salesOptions } from "../api/oversight"
import type { OversightSalesQuery } from "../types"

const COLUMNS = 9

interface SalesListProps {
	query: OversightSalesQuery
	onOffsetChange: (offset: number) => void
	onClearFilters: () => void
}

/**
 * The sales documents, newest first.
 *
 * It answers "which receipt" (P14-D2), not "how much": the rows are the API's own
 * columns, and the conflict badge is a count the server computed for this sale.
 */
export function SalesList({ query, onOffsetChange, onClearFilters }: SalesListProps) {
	const salesQuery = useQuery(salesOptions(query))
	const denied = salesQuery.error instanceof ApiError && salesQuery.error.status === 403
	const requestId = salesQuery.error instanceof ApiError ? salesQuery.error.requestId : undefined
	const sales = salesQuery.data?.sales ?? []

	if (salesQuery.isLoading) {
		return (
			<Card>
				<Table>
					<TableBody>
						<TableMessage colSpan={COLUMNS} state="loading" rows={6}>
							Loading sales…
						</TableMessage>
					</TableBody>
				</Table>
			</Card>
		)
	}

	if (denied) {
		return (
			<EmptyState
				icon={ShieldAlert}
				title="You cannot see POS sales"
				description="This screen needs pos.oversight.read. Ask an administrator if you need access."
			/>
		)
	}

	if (salesQuery.isError) {
		return (
			<Card>
				<Table>
					<TableBody>
						<TableMessage colSpan={COLUMNS} state="error">
							Couldn't load sales.{requestId ? ` Request ${requestId}.` : ""}
						</TableMessage>
					</TableBody>
				</Table>
			</Card>
		)
	}

	if (sales.length === 0) {
		return (
			<Card>
				<EmptyState
					icon={PackageSearch}
					title="No sales match these filters."
					description="A sale appears here once a terminal uploads it. Widen the dates or clear the filters to see more."
					action={
						<Button type="button" variant="outline" size="sm" onClick={onClearFilters}>
							Clear filters
						</Button>
					}
				/>
			</Card>
		)
	}

	return (
		<>
			<Card className="overflow-x-auto">
				<Table>
					<caption className="sr-only">Sales in the selected period, newest first</caption>
					<TableHeader>
						<TableRow>
							<TableHead scope="col">Receipt</TableHead>
							<TableHead scope="col">When</TableHead>
							<TableHead scope="col">Branch</TableHead>
							<TableHead scope="col">Terminal</TableHead>
							<TableHead scope="col">Cashier</TableHead>
							<TableHead scope="col" className="text-right">
								Items
							</TableHead>
							<TableHead scope="col" className="text-right">
								Total
							</TableHead>
							<TableHead scope="col" className="text-right">
								Refunded
							</TableHead>
							<TableHead scope="col">Conflicts</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{sales.map((sale) => (
							<TableRow key={sale.id}>
								<TableCell>
									<Link
										to="/pos/sales/$saleId"
										params={{ saleId: sale.id }}
										className="font-mono text-xs font-medium hover:underline"
									>
										{sale.receiptNumber}
									</Link>
								</TableCell>
								<TableCell className="text-muted-foreground">
									<time dateTime={sale.occurredAt}>{formatDateTime(sale.occurredAt)}</time>
								</TableCell>
								<TableCell className="text-muted-foreground">
									{formatBranchLabel({ name: sale.branchName, code: sale.branchCode })}
								</TableCell>
								<TableCell className="text-muted-foreground">{sale.terminalCode}</TableCell>
								<TableCell className="max-w-36 truncate">{sale.cashierName}</TableCell>
								<TableCell className="text-right tabular-nums">
									{formatCount(sale.itemsSold)}
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{formatGhs(sale.totalMinor)}
								</TableCell>
								<TableCell className="text-right tabular-nums text-muted-foreground">
									{sale.refundedMinor > 0 ? formatGhs(sale.refundedMinor) : "—"}
								</TableCell>
								<TableCell>
									{sale.conflictCount > 0 ? (
										<Link
											to="/pos"
											search={{ tab: "conflicts", saleId: sale.id }}
											aria-label={`${formatCount(sale.conflictCount)} conflicts for receipt ${sale.receiptNumber}`}
										>
											<StatusBadge variant="danger">{formatCount(sale.conflictCount)}</StatusBadge>
										</Link>
									) : (
										<span className="text-muted-foreground">—</span>
									)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</Card>
			<Pagination
				total={salesQuery.data?.total ?? 0}
				limit={salesQuery.data?.limit ?? query.limit ?? 20}
				offset={salesQuery.data?.offset ?? query.offset ?? 0}
				onOffsetChange={onOffsetChange}
			/>
		</>
	)
}
