import { formatCount, formatDateTime } from "@sceptre/shared"
import { useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronRightIcon, PencilIcon } from "lucide-react"
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react"
import { TableMessage, type TableMessageState } from "#/components/common/table-message"
import { Button } from "#/components/ui/button"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { formatGhs } from "#/lib/format"
import { ThresholdDialog } from "#/modules/inventory"
import { replenishmentKeys } from "../api/keys"
import type { ReplenishmentGroup, ReplenishmentResult, ReplenishmentRow } from "../types"
import { MetricTile } from "../ui/metric-tile"
import { SuggestionBasis } from "../ui/suggestion-basis"
import { ReplenishOrderDialog } from "./replenish-order-dialog"
import { UnassignedRowActions } from "./unassigned-row-actions"

interface RaiseTarget {
	supplierId: string
	supplierName: string
	rows: ReplenishmentRow[]
}

function Checkbox({
	checked,
	indeterminate = false,
	disabled = false,
	label,
	onChange,
}: {
	checked: boolean
	indeterminate?: boolean
	disabled?: boolean
	label: string
	onChange: (checked: boolean) => void
}) {
	const ref = useRef<HTMLInputElement>(null)

	useEffect(() => {
		if (ref.current) ref.current.indeterminate = indeterminate
	}, [indeterminate])

	return (
		<input
			ref={ref}
			type="checkbox"
			checked={checked}
			disabled={disabled}
			aria-label={label}
			onChange={(event) => onChange(event.target.checked)}
			className="size-4 cursor-pointer rounded border-input accent-primary disabled:cursor-not-allowed"
		/>
	)
}

function MessageTable({
	colSpan,
	state,
	tone,
	rows,
	children,
}: {
	colSpan: number
	state?: TableMessageState
	tone?: "muted" | "error"
	rows?: number
	children: ReactNode
}) {
	return (
		<div className="rounded-md border">
			<Table>
				<TableBody>
					<TableMessage colSpan={colSpan} state={state} tone={tone} rows={rows}>
						{children}
					</TableMessage>
				</TableBody>
			</Table>
		</div>
	)
}

function ProductCell({ row }: { row: ReplenishmentRow }) {
	return (
		<>
			<p className="font-medium">{row.name}</p>
			<p className="font-mono text-xs text-muted-foreground">{row.sku}</p>
		</>
	)
}

/**
 * The grouped suggestion table: per-supplier sections, selection, the full "Why?" breakdown and
 * the raise-order dialog. All figures are the API's; the screen never derives a quantity or a
 * value.
 */
export function SuggestionsView({
	data,
	isLoading,
	isError,
	onlySuggested,
	hasFilters,
	hasThresholds,
	thresholdsCheckFailed,
	branchId,
	canCreate,
	canEditLevels,
	canChooseSupplier,
	computedAt,
}: {
	data: ReplenishmentResult | null
	isLoading: boolean
	isError: boolean
	onlySuggested: boolean
	hasFilters: boolean
	/** `null` while the page is checking whether the branch has any thresholds at all. */
	hasThresholds: boolean | null
	thresholdsCheckFailed: boolean
	branchId: string
	canCreate: boolean
	canEditLevels: boolean
	canChooseSupplier: boolean
	computedAt: number
}) {
	const queryClient = useQueryClient()
	const [selected, setSelected] = useState<Set<string>>(new Set())
	const [expanded, setExpanded] = useState<Set<string>>(new Set())
	const [raiseTarget, setRaiseTarget] = useState<RaiseTarget | null>(null)
	const [levelsRow, setLevelsRow] = useState<ReplenishmentRow | null>(null)

	const columns = canCreate ? 8 : 7

	function setMany(productIds: string[], checked: boolean) {
		setSelected((current) => {
			const next = new Set(current)
			for (const productId of productIds) {
				if (checked) next.add(productId)
				else next.delete(productId)
			}
			return next
		})
	}

	function toggleExpanded(productId: string) {
		setExpanded((current) => {
			const next = new Set(current)
			if (next.has(productId)) next.delete(productId)
			else next.add(productId)
			return next
		})
	}

	if (isLoading) {
		return (
			<MessageTable colSpan={columns} state="loading" rows={6}>
				Loading replenishment suggestions…
			</MessageTable>
		)
	}

	if (isError || !data) {
		return (
			<MessageTable colSpan={columns} tone="error">
				Couldn't load replenishment suggestions.
			</MessageTable>
		)
	}

	if (data.totals.rows === 0) {
		if (hasFilters) {
			return <MessageTable colSpan={columns}>No stock levels match these filters.</MessageTable>
		}

		if (!onlySuggested) {
			return (
				<MessageTable colSpan={columns}>
					This branch carries no stock yet, so there is nothing to replenish. A product appears here
					once it has a stock level or a minimum on its stock page — and until then it uses the
					branch or company default threshold.{" "}
					<Link to="/inventory/stock" className="font-medium text-primary hover:underline">
						Open stock
					</Link>
				</MessageTable>
			)
		}

		if (hasThresholds === null && !thresholdsCheckFailed) {
			return (
				<MessageTable colSpan={columns} state="loading">
					Checking whether stock levels are set…
				</MessageTable>
			)
		}
		if (hasThresholds === false) {
			return (
				<MessageTable colSpan={columns}>
					This branch carries no stock yet, so there is nothing to replenish. A product appears here
					once it has a stock level or a minimum on its stock page — and until then it uses the
					branch or company default threshold.{" "}
					<Link to="/inventory/stock" className="font-medium text-primary hover:underline">
						Open stock
					</Link>
				</MessageTable>
			)
		}
		return (
			<MessageTable colSpan={columns}>
				Nothing needs ordering today. Last computed {formatDateTime(computedAt)}.
				{thresholdsCheckFailed ? " The branch's stock levels could not be checked." : ""}
			</MessageTable>
		)
	}

	const hasUnassigned = data.unassigned.rows.length > 0

	return (
		<div className="grid gap-4">
			<div className="grid gap-3 sm:grid-cols-3">
				<MetricTile
					label="Lines suggested"
					value={formatCount(data.totals.rows)}
					explanation="Lines returned by the current branch, supplier and search filters."
				/>
				<MetricTile
					label="Units to order"
					value={formatCount(data.totals.suggestedUnits)}
					explanation="The sum of the suggestions on those lines, as the API computed them."
				/>
				<MetricTile
					label="Value at last cost"
					value={formatGhs(data.totals.valueMinor)}
					explanation="Suggested quantity × the last cost the API resolved for each line."
				/>
			</div>

			{data.totalRows > data.totals.rows ? (
				<p className="text-sm text-muted-foreground">
					Showing the first {formatCount(data.totals.rows)} of {formatCount(data.totalRows)}{" "}
					matching lines. Narrow the search to see the rest.
				</p>
			) : null}

			{data.groups.map((group) => (
				<AssignedGroup
					key={group.supplierId}
					group={group}
					safetyDays={data.settings.safetyDays}
					canCreate={canCreate}
					canEditLevels={canEditLevels}
					selected={selected}
					expanded={expanded}
					onToggleRow={(productId, checked) => setMany([productId], checked)}
					onToggleGroup={(checked) =>
						setMany(
							group.rows.filter((row) => row.suggested > 0).map((row) => row.productId),
							checked,
						)
					}
					onToggleExpanded={toggleExpanded}
					onEditLevels={setLevelsRow}
					onRaise={setRaiseTarget}
				/>
			))}

			{hasUnassigned ? (
				<UnassignedGroup
					group={data.unassigned}
					safetyDays={data.settings.safetyDays}
					canChooseSupplier={canChooseSupplier}
					canEditLevels={canEditLevels}
					expanded={expanded}
					onToggleExpanded={toggleExpanded}
					onEditLevels={setLevelsRow}
				/>
			) : null}

			{raiseTarget ? (
				<ReplenishOrderDialog
					open
					onOpenChange={(open) => {
						if (!open) {
							setRaiseTarget(null)
							setSelected(new Set())
						}
					}}
					branchId={branchId}
					supplierId={raiseTarget.supplierId}
					supplierName={raiseTarget.supplierName}
					rows={raiseTarget.rows}
				/>
			) : null}

			{levelsRow ? (
				<ThresholdDialog
					open
					onOpenChange={(open) => {
						if (!open) setLevelsRow(null)
					}}
					branchId={branchId}
					productId={levelsRow.productId}
					productName={`${levelsRow.sku} — ${levelsRow.name}`}
					currentThreshold={levelsRow.minLevel}
					currentMaxQuantity={levelsRow.maxLevel}
					currentMinOrderQuantity={levelsRow.minOrderQuantity}
					onSaved={() => {
						void queryClient.invalidateQueries({ queryKey: replenishmentKeys.all })
					}}
				/>
			) : null}
		</div>
	)
}

function GroupSummary({
	name,
	leadTimeDays,
	leadTimeAssumed,
	totalValueMinor,
}: {
	name: string
	leadTimeDays: number
	leadTimeAssumed: boolean
	totalValueMinor: number
}) {
	return (
		<summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-6 gap-y-1 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
			<ChevronRightIcon
				className="size-4 text-muted-foreground transition-transform group-open:rotate-90"
				aria-hidden="true"
			/>
			<span className="font-medium">{name}</span>
			<span className="text-sm text-muted-foreground">
				Lead time {formatCount(leadTimeDays)} days
				{leadTimeAssumed ? " (assumed for some lines)" : ""}
			</span>
			<span className="ml-auto text-sm font-medium tabular-nums">{formatGhs(totalValueMinor)}</span>
		</summary>
	)
}

function AssignedGroup({
	group,
	safetyDays,
	canCreate,
	canEditLevels,
	selected,
	expanded,
	onToggleRow,
	onToggleGroup,
	onToggleExpanded,
	onEditLevels,
	onRaise,
}: {
	group: ReplenishmentGroup
	safetyDays: number
	canCreate: boolean
	canEditLevels: boolean
	selected: Set<string>
	expanded: Set<string>
	onToggleRow: (productId: string, checked: boolean) => void
	onToggleGroup: (checked: boolean) => void
	onToggleExpanded: (productId: string) => void
	onEditLevels: (row: ReplenishmentRow) => void
	onRaise: (target: RaiseTarget) => void
}) {
	const columns = canCreate ? 8 : 7
	const selectable = group.rows.filter((row) => row.suggested > 0)
	const selectedRows = group.rows.filter((row) => selected.has(row.productId))
	const allSelected =
		selectable.length > 0 && selectable.every((row) => selected.has(row.productId))
	const someSelected = selectable.some((row) => selected.has(row.productId)) && !allSelected
	const selectedValueMinor = selectedRows.reduce((total, row) => total + row.suggestedValueMinor, 0)

	return (
		<details open className="group rounded-md border bg-card">
			<GroupSummary
				name={group.supplierName}
				leadTimeDays={group.leadTimeDays}
				leadTimeAssumed={group.leadTimeAssumed}
				totalValueMinor={group.totalValueMinor}
			/>

			<Table>
				<caption className="sr-only">Suggested lines for {group.supplierName}</caption>
				<TableHeader>
					<TableRow>
						{canCreate ? (
							<TableHead className="w-10">
								<Checkbox
									checked={allSelected}
									indeterminate={someSelected}
									disabled={selectable.length === 0}
									label={`Select all lines for ${group.supplierName}`}
									onChange={onToggleGroup}
								/>
							</TableHead>
						) : null}
						<TableHead>Product</TableHead>
						<TableHead className="text-right">On hand</TableHead>
						<TableHead className="text-right">On order</TableHead>
						<TableHead className="text-right">Suggested</TableHead>
						<TableHead className="text-right">Unit cost</TableHead>
						<TableHead className="text-right">Value</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{group.rows.map((row) => {
						const isExpanded = expanded.has(row.productId)
						return (
							<Fragment key={row.productId}>
								<TableRow>
									{canCreate ? (
										<TableCell>
											<Checkbox
												checked={selected.has(row.productId)}
												disabled={row.suggested <= 0}
												label={`Select ${row.sku} ${row.name}`}
												onChange={(checked) => onToggleRow(row.productId, checked)}
											/>
										</TableCell>
									) : null}
									<TableCell>
										<ProductCell row={row} />
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatCount(row.onHand)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatCount(row.onOrder)}
									</TableCell>
									<TableCell className="text-right font-medium tabular-nums">
										{formatCount(row.suggested)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatGhs(row.lastCostMinor)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatGhs(row.suggestedValueMinor)}
									</TableCell>
									<TableCell>
										<div className="flex flex-wrap justify-end gap-1">
											<Button
												type="button"
												variant="ghost"
												size="sm"
												aria-expanded={isExpanded}
												aria-controls={`basis-${row.productId}`}
												onClick={() => onToggleExpanded(row.productId)}
											>
												Why?
											</Button>
											{canEditLevels ? (
												<Button
													type="button"
													variant="ghost"
													size="sm"
													aria-label={`Edit stock levels for ${row.name}`}
													onClick={() => onEditLevels(row)}
												>
													<PencilIcon className="size-4" aria-hidden="true" />
													Edit levels
												</Button>
											) : null}
										</div>
									</TableCell>
								</TableRow>
								<TableRow id={`basis-${row.productId}`} hidden={!isExpanded}>
									<TableCell colSpan={columns} className="bg-muted/30">
										{isExpanded ? <SuggestionBasis row={row} safetyDays={safetyDays} /> : null}
									</TableCell>
								</TableRow>
							</Fragment>
						)
					})}
				</TableBody>
			</Table>

			<div className="flex flex-wrap items-center justify-between gap-2 border-t px-3 py-2">
				<p className="text-sm text-muted-foreground">
					{canCreate
						? `${formatCount(selectedRows.length)} lines · ${formatGhs(selectedValueMinor)}`
						: `${formatCount(group.rows.length)} lines · ${formatGhs(group.totalValueMinor)}`}
				</p>
				{canCreate ? (
					<Button
						type="button"
						size="sm"
						disabled={selectedRows.length === 0}
						onClick={() =>
							onRaise({
								supplierId: group.supplierId,
								supplierName: group.supplierName,
								rows: selectedRows,
							})
						}
					>
						Raise order
					</Button>
				) : null}
			</div>
		</details>
	)
}

function UnassignedGroup({
	group,
	safetyDays,
	canChooseSupplier,
	canEditLevels,
	expanded,
	onToggleExpanded,
	onEditLevels,
}: {
	group: ReplenishmentGroup
	safetyDays: number
	canChooseSupplier: boolean
	canEditLevels: boolean
	expanded: Set<string>
	onToggleExpanded: (productId: string) => void
	onEditLevels: (row: ReplenishmentRow) => void
}) {
	const columns = 7

	return (
		<details open className="group rounded-md border border-dashed bg-card">
			<GroupSummary
				name="Unassigned"
				leadTimeDays={group.leadTimeDays}
				leadTimeAssumed={group.leadTimeAssumed}
				totalValueMinor={group.totalValueMinor}
			/>
			<p className="border-t px-3 py-2 text-sm text-muted-foreground">
				These parts have no preferred supplier. Choose one to include them in an order.
			</p>

			<Table>
				<caption className="sr-only">Parts with no preferred supplier</caption>
				<TableHeader>
					<TableRow>
						<TableHead>Product</TableHead>
						<TableHead className="text-right">On hand</TableHead>
						<TableHead className="text-right">On order</TableHead>
						<TableHead className="text-right">Suggested</TableHead>
						<TableHead className="text-right">Unit cost</TableHead>
						<TableHead className="text-right">Value</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{group.rows.map((row) => {
						const isExpanded = expanded.has(row.productId)
						return (
							<Fragment key={row.productId}>
								<TableRow>
									<TableCell>
										<ProductCell row={row} />
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatCount(row.onHand)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatCount(row.onOrder)}
									</TableCell>
									<TableCell className="text-right font-medium tabular-nums">
										{formatCount(row.suggested)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatGhs(row.lastCostMinor)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{formatGhs(row.suggestedValueMinor)}
									</TableCell>
									<TableCell>
										<div className="flex flex-wrap justify-end gap-1">
											<Button
												type="button"
												variant="ghost"
												size="sm"
												aria-expanded={isExpanded}
												aria-controls={`basis-${row.productId}`}
												onClick={() => onToggleExpanded(row.productId)}
											>
												Why?
											</Button>
											{canEditLevels ? (
												<Button
													type="button"
													variant="ghost"
													size="sm"
													aria-label={`Edit stock levels for ${row.name}`}
													onClick={() => onEditLevels(row)}
												>
													<PencilIcon className="size-4" aria-hidden="true" />
													Edit levels
												</Button>
											) : null}
											{canChooseSupplier ? (
												<UnassignedRowActions row={row} />
											) : (
												<span className="self-center text-xs text-muted-foreground">
													No preferred supplier
												</span>
											)}
										</div>
									</TableCell>
								</TableRow>
								<TableRow id={`basis-${row.productId}`} hidden={!isExpanded}>
									<TableCell colSpan={columns} className="bg-muted/30">
										{isExpanded ? <SuggestionBasis row={row} safetyDays={safetyDays} /> : null}
									</TableCell>
								</TableRow>
							</Fragment>
						)
					})}
				</TableBody>
			</Table>

			<div className="border-t px-3 py-2 text-sm text-muted-foreground">
				{formatCount(group.rows.length)} lines · {formatGhs(group.totalValueMinor)}
			</div>
		</details>
	)
}
