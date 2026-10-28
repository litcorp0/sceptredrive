import { formatDateTime } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { Clock, ShieldAlert } from "lucide-react"
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
import { shiftsOptions } from "../api/oversight"
import type { OversightShiftsQuery } from "../types"
import {
	reviewStatusLabel,
	reviewStatusTone,
	shiftStatusTone,
	signedMoney,
	varianceTone,
} from "../utils/labels"

const COLUMNS = 10

interface ShiftsListProps {
	query: OversightShiftsQuery
	onOffsetChange: (offset: number) => void
	onClearFilters: () => void
}

/**
 * One row per drawer session. The expected cash and the counted cash are the server's
 * figures; the console renders the variance the API computed and never subtracts them.
 */
export function ShiftsList({ query, onOffsetChange, onClearFilters }: ShiftsListProps) {
	const shiftsQuery = useQuery(shiftsOptions(query))
	const denied = shiftsQuery.error instanceof ApiError && shiftsQuery.error.status === 403
	const requestId = shiftsQuery.error instanceof ApiError ? shiftsQuery.error.requestId : undefined
	const shifts = shiftsQuery.data?.shifts ?? []

	if (shiftsQuery.isLoading) {
		return (
			<Card>
				<Table>
					<TableBody>
						<TableMessage colSpan={COLUMNS} state="loading" rows={6}>
							Loading shifts…
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
				title="You cannot see shifts"
				description="This screen needs pos.oversight.read. Ask an administrator if you need access."
			/>
		)
	}

	if (shiftsQuery.isError) {
		return (
			<Card>
				<Table>
					<TableBody>
						<TableMessage colSpan={COLUMNS} state="error">
							Couldn't load shifts.{requestId ? ` Request ${requestId}.` : ""}
						</TableMessage>
					</TableBody>
				</Table>
			</Card>
		)
	}

	if (shifts.length === 0) {
		return (
			<Card>
				<EmptyState
					icon={Clock}
					title="No shifts match these filters."
					description="A shift appears here once a terminal opens one. Widen the dates or clear the filters to see more."
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
					<caption className="sr-only">Shifts in the selected period, newest first</caption>
					<TableHeader>
						<TableRow>
							<TableHead scope="col">Number</TableHead>
							<TableHead scope="col">Status</TableHead>
							<TableHead scope="col">Opened</TableHead>
							<TableHead scope="col">Closed</TableHead>
							<TableHead scope="col">Terminal</TableHead>
							<TableHead scope="col">Cashier</TableHead>
							<TableHead scope="col" className="text-right">
								Counted
							</TableHead>
							<TableHead scope="col" className="text-right">
								Expected
							</TableHead>
							<TableHead scope="col" className="text-right">
								Variance
							</TableHead>
							<TableHead scope="col">Review</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{shifts.map((shift) => (
							<TableRow key={shift.id}>
								<TableCell>
									<Link
										to="/pos/shifts/$shiftId"
										params={{ shiftId: shift.id }}
										className="font-mono text-xs font-medium hover:underline"
									>
										{shift.number}
									</Link>
								</TableCell>
								<TableCell>
									<StatusBadge variant={shiftStatusTone(shift.status)}>
										{shift.status === "OPEN" ? "Open" : "Closed"}
									</StatusBadge>
								</TableCell>
								<TableCell className="text-muted-foreground">
									<time dateTime={shift.openedAt}>{formatDateTime(shift.openedAt)}</time>
								</TableCell>
								<TableCell className="text-muted-foreground">
									{shift.closedAt ? (
										<time dateTime={shift.closedAt}>{formatDateTime(shift.closedAt)}</time>
									) : (
										"—"
									)}
								</TableCell>
								<TableCell className="text-muted-foreground">{shift.terminalCode}</TableCell>
								<TableCell className="max-w-36 truncate">{shift.cashierName}</TableCell>
								<TableCell className="text-right tabular-nums">
									{shift.countedCashMinor === null ? (
										<span className="text-muted-foreground">Not counted</span>
									) : (
										formatGhs(shift.countedCashMinor)
									)}
								</TableCell>
								<TableCell className="text-right tabular-nums text-muted-foreground">
									{shift.serverExpectedCashMinor === null
										? "—"
										: formatGhs(shift.serverExpectedCashMinor)}
								</TableCell>
								<TableCell className="text-right">
									{shift.varianceMinor === null ? (
										<span className="text-muted-foreground">—</span>
									) : (
										<StatusBadge variant={varianceTone(shift.varianceMinor)}>
											{signedMoney(shift.varianceMinor)}
										</StatusBadge>
									)}
								</TableCell>
								<TableCell>
									<StatusBadge variant={reviewStatusTone(shift.reviewStatus)}>
										{reviewStatusLabel(shift.reviewStatus)}
									</StatusBadge>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</Card>
			<Pagination
				total={shiftsQuery.data?.total ?? 0}
				limit={shiftsQuery.data?.limit ?? query.limit ?? 20}
				offset={shiftsQuery.data?.offset ?? query.offset ?? 0}
				onOffsetChange={onOffsetChange}
			/>
		</>
	)
}
