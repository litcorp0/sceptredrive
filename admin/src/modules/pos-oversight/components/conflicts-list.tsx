import { FLAG_DEFAULTS, formatDateTime } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { getRouteApi, Link } from "@tanstack/react-router"
import { ShieldAlert, ShieldQuestion } from "lucide-react"
import { useState } from "react"
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
import { useBranch } from "#/lib/branch-context"
import { branchLabelFor } from "#/lib/branch-label"
import { hasPermission } from "#/lib/role"
import { settingsListOptions } from "#/modules/settings"
import { conflictsOptions } from "../api/oversight"
import type { ConflictListQuery } from "../types"
import {
	conflictSeverityTone,
	conflictStatusLabel,
	conflictStatusTone,
	conflictTypeLabel,
} from "../utils/labels"
import { ConflictSheet } from "./conflict-sheet"

const COLUMNS = 6
const authenticatedRoute = getRouteApi("/_authenticated")

interface ConflictsListProps {
	query: ConflictListQuery
	onOffsetChange: (offset: number) => void
	onClearFilters: () => void
}

/**
 * The conflict queue, HIGH severity first (the API orders it; the console does not re-sort).
 *
 * A row opens the sheet rather than navigating: the reviewer needs the conflict and its
 * document side by side, and a resolution is a short decision. Resolving is offered only
 * when the role holds `conflict.resolve` **and** `flag.posConflictResolution` is on
 * (P14-D41, Plan 10 §6). With the flag off the queue stays readable — the flag switches
 * resolution off, not oversight.
 */
export function ConflictsList({ query, onOffsetChange, onClearFilters }: ConflictsListProps) {
	const { session } = authenticatedRoute.useRouteContext()
	const { branches } = useBranch()
	const canResolve = hasPermission(session.user.role, "conflict.resolve")

	// A flag is a typed setting (P14-D41), not a second store. A missing row means its
	// registry default, never "off", and only a real boolean turns resolution on.
	const settingsQuery = useQuery(settingsListOptions())
	const resolutionSetting = settingsQuery.data?.settings.find(
		(setting) => setting.key === "flag.posConflictResolution",
	)
	const resolutionEnabled =
		typeof resolutionSetting?.value === "boolean"
			? resolutionSetting.value
			: FLAG_DEFAULTS["flag.posConflictResolution"]

	const [selectedId, setSelectedId] = useState<string | null>(null)

	const conflictsQuery = useQuery(conflictsOptions(query))
	const denied = conflictsQuery.error instanceof ApiError && conflictsQuery.error.status === 403
	const requestId =
		conflictsQuery.error instanceof ApiError ? conflictsQuery.error.requestId : undefined
	const conflicts = conflictsQuery.data?.conflicts ?? []

	if (conflictsQuery.isLoading) {
		return (
			<Card>
				<Table>
					<TableBody>
						<TableMessage colSpan={COLUMNS} state="loading" rows={6}>
							Loading conflicts…
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
				title="You cannot see the conflict queue"
				description="This screen needs conflict.read. Ask an administrator if you need access."
			/>
		)
	}

	if (conflictsQuery.isError) {
		return (
			<Card>
				<Table>
					<TableBody>
						<TableMessage colSpan={COLUMNS} state="error">
							Couldn't load conflicts.{requestId ? ` Request ${requestId}.` : ""}
						</TableMessage>
					</TableBody>
				</Table>
			</Card>
		)
	}

	if (conflicts.length === 0) {
		return (
			<Card>
				<EmptyState
					icon={ShieldQuestion}
					title="No conflicts match these filters."
					description="Every sync conflict the terminals raised will appear here. Clear the filters or change the status to see the history."
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
			{query.saleId ? (
				<div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
					<span>Showing conflicts raised by one sale.</span>
					<Button type="button" variant="link" size="sm" onClick={onClearFilters}>
						Show all conflicts
					</Button>
				</div>
			) : null}

			<Card className="overflow-x-auto">
				<Table>
					<caption className="sr-only">
						Sync conflicts in the selected period, HIGH severity first
					</caption>
					<TableHeader>
						<TableRow>
							<TableHead scope="col">Conflict</TableHead>
							<TableHead scope="col">Created</TableHead>
							<TableHead scope="col">Branch</TableHead>
							<TableHead scope="col">Terminal</TableHead>
							<TableHead scope="col">Document</TableHead>
							<TableHead scope="col">Status</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{conflicts.map((conflict) => (
							<TableRow key={conflict.id}>
								<TableCell>
									<button
										type="button"
										className="flex w-full items-center gap-2 rounded-sm text-left hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
										onClick={() => setSelectedId(conflict.id)}
										aria-haspopup="dialog"
										aria-label={`Open ${conflictTypeLabel(conflict.type)} conflict`}
									>
										<StatusBadge variant={conflictSeverityTone(conflict.severity)}>
											{conflict.severity}
										</StatusBadge>
										<span className="truncate">{conflictTypeLabel(conflict.type)}</span>
									</button>
								</TableCell>
								<TableCell className="text-muted-foreground">
									<time dateTime={conflict.createdAt}>{formatDateTime(conflict.createdAt)}</time>
								</TableCell>
								<TableCell className="text-muted-foreground">
									{branchLabelFor(branches, { code: conflict.branchCode })}
								</TableCell>
								<TableCell className="text-muted-foreground">{conflict.terminalCode}</TableCell>
								<TableCell>
									{conflict.saleId ? (
										<Link
											to="/pos/sales/$saleId"
											params={{ saleId: conflict.saleId }}
											className="font-mono text-xs hover:underline"
										>
											{conflict.receiptNumber ?? "Sale"}
										</Link>
									) : conflict.shiftId ? (
										<Link
											to="/pos/shifts/$shiftId"
											params={{ shiftId: conflict.shiftId }}
											className="font-mono text-xs hover:underline"
										>
											{conflict.shiftNumber ?? "Shift"}
										</Link>
									) : (
										<span className="text-muted-foreground">No document</span>
									)}
								</TableCell>
								<TableCell>
									<StatusBadge variant={conflictStatusTone(conflict.status)}>
										{conflictStatusLabel(conflict.status)}
									</StatusBadge>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</Card>

			<Pagination
				total={conflictsQuery.data?.total ?? 0}
				limit={conflictsQuery.data?.limit ?? query.limit ?? 20}
				offset={conflictsQuery.data?.offset ?? query.offset ?? 0}
				onOffsetChange={onOffsetChange}
			/>

			<ConflictSheet
				conflictId={selectedId}
				onClose={() => setSelectedId(null)}
				canResolve={canResolve}
				resolutionEnabled={resolutionEnabled}
			/>
		</>
	)
}
