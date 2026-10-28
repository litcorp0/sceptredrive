import { REFUND_REASON_LABELS, REFUND_REASONS } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { useBranch } from "#/lib/branch-context"
import { terminalListOptions } from "#/modules/terminals"
import type { PosSearch, PosTab } from "../utils/search"

const ALL = "ALL"

interface OversightFiltersProps {
	tab: PosTab
	search: PosSearch
	onChange: (patch: Partial<PosSearch>) => void
	onClear: () => void
}

/**
 * The filters every oversight list shares.
 *
 * A filter is only useful here if a colleague can receive it, so every control writes
 * the URL rather than component state. The branch comes from the shell's switcher; the
 * terminal list comes from the owning module's barrel and is itself branch-scoped.
 */
export function OversightFilters({ tab, search, onChange, onClear }: OversightFiltersProps) {
	const { activeBranchId } = useBranch()
	const terminalsQuery = useQuery(
		terminalListOptions({ branchId: activeBranchId ?? undefined, includeInactive: false }),
	)
	const terminals = terminalsQuery.data?.terminals ?? []

	const hasFilters = Boolean(
		search.from ??
			search.to ??
			search.terminalId ??
			search.receiptNumber ??
			search.status ??
			search.severity ??
			search.reasonCode ??
			search.method ??
			search.tenderStatus ??
			search.shiftStatus ??
			search.reviewStatus ??
			search.saleId ??
			search.shiftId,
	)

	return (
		<div className="mb-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
			<div className="grid gap-1.5">
				<Label htmlFor="pos-from">From</Label>
				<Input
					id="pos-from"
					type="date"
					value={search.from ?? ""}
					onChange={(event) => onChange({ from: event.target.value || undefined })}
				/>
			</div>

			<div className="grid gap-1.5">
				<Label htmlFor="pos-to">To</Label>
				<Input
					id="pos-to"
					type="date"
					value={search.to ?? ""}
					onChange={(event) => onChange({ to: event.target.value || undefined })}
				/>
			</div>

			<div className="grid gap-1.5">
				<Label htmlFor="pos-terminal">Terminal</Label>
				<Select
					value={search.terminalId ?? ALL}
					onValueChange={(value) => onChange({ terminalId: value === ALL ? undefined : value })}
				>
					<SelectTrigger id="pos-terminal" className="w-full">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={ALL}>All terminals</SelectItem>
						{terminals.map((terminal) => (
							<SelectItem key={terminal.id} value={terminal.id}>
								{terminal.code} · {terminal.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{tab === "sales" ? (
				<div className="grid gap-1.5">
					<Label htmlFor="pos-receipt">Receipt number</Label>
					<Input
						id="pos-receipt"
						value={search.receiptNumber ?? ""}
						placeholder="RCP-…"
						onChange={(event) => onChange({ receiptNumber: event.target.value || undefined })}
					/>
				</div>
			) : null}

			{tab === "refunds" ? (
				<>
					<div className="grid gap-1.5">
						<Label htmlFor="pos-refund-reason">Reason</Label>
						<Select
							value={search.reasonCode ?? ALL}
							onValueChange={(value) =>
								onChange({
									// The shared enum is the API's, so the control cannot offer a code it rejects.
									reasonCode:
										value === ALL ? undefined : (value as (typeof REFUND_REASONS)[number]),
								})
							}
						>
							<SelectTrigger id="pos-refund-reason" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={ALL}>All reasons</SelectItem>
								{REFUND_REASONS.map((code) => (
									<SelectItem key={code} value={code}>
										{REFUND_REASON_LABELS[code]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="pos-refund-tender">Tender status</Label>
						<Select
							value={search.tenderStatus ?? ALL}
							onValueChange={(value) =>
								onChange({
									tenderStatus:
										value === ALL
											? undefined
											: (value as "SETTLED" | "PENDING" | "FAILED" | "NEEDS_ATTENTION"),
								})
							}
						>
							<SelectTrigger id="pos-refund-tender" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={ALL}>Any tender state</SelectItem>
								<SelectItem value="SETTLED">Settled</SelectItem>
								<SelectItem value="PENDING">Pending</SelectItem>
								<SelectItem value="FAILED">Failed</SelectItem>
								<SelectItem value="NEEDS_ATTENTION">Needs attention</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</>
			) : null}

			{tab === "shifts" ? (
				<>
					<div className="grid gap-1.5">
						<Label htmlFor="pos-shift-status">Shift</Label>
						<Select
							value={search.shiftStatus ?? ALL}
							onValueChange={(value) =>
								onChange({
									shiftStatus: value === ALL ? undefined : (value as "OPEN" | "CLOSED"),
								})
							}
						>
							<SelectTrigger id="pos-shift-status" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={ALL}>Open and closed</SelectItem>
								<SelectItem value="OPEN">Open</SelectItem>
								<SelectItem value="CLOSED">Closed</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="pos-review-status">Review</Label>
						<Select
							value={search.reviewStatus ?? ALL}
							onValueChange={(value) =>
								onChange({
									reviewStatus:
										value === ALL ? undefined : (value as "NONE" | "REQUIRED" | "REVIEWED"),
								})
							}
						>
							<SelectTrigger id="pos-review-status" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={ALL}>Any review state</SelectItem>
								<SelectItem value="NONE">No review</SelectItem>
								<SelectItem value="REQUIRED">Review required</SelectItem>
								<SelectItem value="REVIEWED">Reviewed</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</>
			) : null}

			{tab === "conflicts" ? (
				<>
					<div className="grid gap-1.5">
						<Label htmlFor="pos-conflict-status">Status</Label>
						<Select
							value={search.status ?? "OPEN"}
							onValueChange={(value) =>
								onChange({
									status: value as "OPEN" | "RESOLVED" | "DISMISSED" | "ALL",
								})
							}
						>
							<SelectTrigger id="pos-conflict-status" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="OPEN">Open</SelectItem>
								<SelectItem value="RESOLVED">Resolved</SelectItem>
								<SelectItem value="DISMISSED">Dismissed</SelectItem>
								<SelectItem value="ALL">All statuses</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="grid gap-1.5">
						<Label htmlFor="pos-conflict-severity">Severity</Label>
						<Select
							value={search.severity ?? ALL}
							onValueChange={(value) =>
								onChange({
									severity: value === ALL ? undefined : (value as "LOW" | "MEDIUM" | "HIGH"),
								})
							}
						>
							<SelectTrigger id="pos-conflict-severity" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value={ALL}>Any severity</SelectItem>
								<SelectItem value="HIGH">High</SelectItem>
								<SelectItem value="MEDIUM">Medium</SelectItem>
								<SelectItem value="LOW">Low</SelectItem>
							</SelectContent>
						</Select>
					</div>
				</>
			) : null}

			{hasFilters ? (
				<div className="flex items-end">
					<Button type="button" variant="ghost" size="sm" onClick={onClear}>
						Clear filters
					</Button>
				</div>
			) : null}
		</div>
	)
}
