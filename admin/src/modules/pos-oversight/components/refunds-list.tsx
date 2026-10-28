import { formatCount, formatDateTime } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ShieldAlert, Undo2 } from "lucide-react"
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
import { refundsOptions } from "../api/oversight"
import type { OversightRefundsQuery } from "../types"
import { refundReasonLabel } from "../utils/labels"

const COLUMNS = 7

interface RefundsListProps {
	query: OversightRefundsQuery
	onOffsetChange: (offset: number) => void
	onClearFilters: () => void
}

/**
 * Every refund, including the ones that never needed an approval.
 *
 * A refund is not hidden because `approvalId` is null: most are below the threshold and
 * are exactly the documents a manager opens to check that money went back. A tender that
 * has not settled is marked on the row, because "refunded" and "returned to the customer"
 * are different facts.
 */
export function RefundsList({ query, onOffsetChange, onClearFilters }: RefundsListProps) {
	const refundsQuery = useQuery(refundsOptions(query))
	const denied = refundsQuery.error instanceof ApiError && refundsQuery.error.status === 403
	const requestId =
		refundsQuery.error instanceof ApiError ? refundsQuery.error.requestId : undefined
	const refunds = refundsQuery.data?.refunds ?? []

	if (refundsQuery.isLoading) {
		return (
			<Card>
				<Table>
					<TableBody>
						<TableMessage colSpan={COLUMNS} state="loading" rows={6}>
							Loading refunds…
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
				title="You cannot see refunds"
				description="This screen needs pos.oversight.read. Ask an administrator if you need access."
			/>
		)
	}

	if (refundsQuery.isError) {
		return (
			<Card>
				<Table>
					<TableBody>
						<TableMessage colSpan={COLUMNS} state="error">
							Couldn't load refunds.{requestId ? ` Request ${requestId}.` : ""}
						</TableMessage>
					</TableBody>
				</Table>
			</Card>
		)
	}

	if (refunds.length === 0) {
		return (
			<Card>
				<EmptyState
					icon={Undo2}
					title="No refunds match these filters."
					description="A refund appears here once a terminal uploads it. Widen the dates or clear the filters to see more."
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
					<caption className="sr-only">Refunds in the selected period, newest first</caption>
					<TableHeader>
						<TableRow>
							<TableHead scope="col">Number</TableHead>
							<TableHead scope="col">When</TableHead>
							<TableHead scope="col">Receipt</TableHead>
							<TableHead scope="col" className="text-right">
								Refunded
							</TableHead>
							<TableHead scope="col">Reason</TableHead>
							<TableHead scope="col">Tenders</TableHead>
							<TableHead scope="col">Approval</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{refunds.map((refund) => (
							<TableRow key={refund.id}>
								<TableCell>
									<Link
										to="/pos/refunds/$refundId"
										params={{ refundId: refund.id }}
										className="font-mono text-xs font-medium hover:underline"
									>
										{refund.number}
									</Link>
								</TableCell>
								<TableCell className="text-muted-foreground">
									<time dateTime={refund.occurredAt}>{formatDateTime(refund.occurredAt)}</time>
								</TableCell>
								<TableCell>
									<Link
										to="/pos/sales/$saleId"
										params={{ saleId: refund.saleId }}
										className="font-mono text-xs hover:underline"
									>
										{refund.receiptNumber}
									</Link>
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{formatGhs(refund.refundedMinor)}
								</TableCell>
								<TableCell className="max-w-44 truncate">
									{refundReasonLabel(refund.reasonCode)}
								</TableCell>
								<TableCell>
									<span className="flex flex-wrap items-center gap-2">
										<span className="tabular-nums text-muted-foreground">
											{formatCount(refund.tenderCount)}
										</span>
										{refund.hasPendingTender ? (
											<StatusBadge variant="warn">Not settled</StatusBadge>
										) : null}
									</span>
								</TableCell>
								<TableCell>
									{refund.approvalId ? (
										<Link
											to="/approvals/$approvalId"
											params={{ approvalId: refund.approvalId }}
											className="text-sm hover:underline"
										>
											Approval
										</Link>
									) : (
										<span className="text-muted-foreground">Not required</span>
									)}
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</Card>
			<Pagination
				total={refundsQuery.data?.total ?? 0}
				limit={refundsQuery.data?.limit ?? query.limit ?? 20}
				offset={refundsQuery.data?.offset ?? query.offset ?? 0}
				onOffsetChange={onOffsetChange}
			/>
		</>
	)
}
