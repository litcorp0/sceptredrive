import { formatDateTime, formatDay } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { Pagination } from "#/components/common/pagination"
import { StatusBadge } from "#/components/common/status-badge"
import { TableMessage } from "#/components/common/table-message"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { api } from "#/lib/api"
import type { CreditEntryKind } from "#/lib/api-types"
import { formatGhs } from "#/lib/format"
import { CREDIT_KIND_LABELS, CREDIT_KIND_TONES, signedGhs } from "#/modules/credit"

const PAGE_SIZE = 20

export function CreditLedgerTable({
	customerId,
	branchId,
	currentBalanceMinor,
}: {
	customerId: string
	branchId: string | null
	currentBalanceMinor: number | null
}) {
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const [kind, setKind] = useState<"ALL" | CreditEntryKind>("ALL")
	const [offset, setOffset] = useState(0)

	const page = Math.floor(offset / PAGE_SIZE) + 1
	const filters = {
		from: from || undefined,
		to: to || undefined,
		kind: kind === "ALL" ? undefined : kind,
		page,
		pageSize: PAGE_SIZE,
	}

	const entriesQuery = useQuery({
		queryKey: ["credit-entries", customerId, branchId, filters],
		queryFn: () =>
			api.credit.entries.list({ customerId, branchId: branchId ?? undefined, ...filters }),
		enabled: branchId !== null,
	})

	const entries = entriesQuery.data?.entries ?? []
	const total = entriesQuery.data?.total ?? 0
	const hasFilters = from !== "" || to !== "" || kind !== "ALL"

	// Running balances anchor to the profile's current balance. That is only
	// truthful when this page starts at the newest entry and no newer entry is
	// filtered out — with a kind/date-to filter or a later page, show a dash.
	const balances = useMemo(() => {
		if (kind !== "ALL" || to !== "" || page !== 1 || currentBalanceMinor === null) return null
		const map = new Map<string, number>()
		let running = currentBalanceMinor
		for (const entry of entries) {
			map.set(entry.id, running)
			running -= entry.amountMinor
		}
		return map
	}, [entries, kind, to, page, currentBalanceMinor])

	if (branchId === null) {
		return (
			<p className="text-sm text-muted-foreground">Choose a branch to view its credit ledger.</p>
		)
	}

	return (
		<section>
			<div className="mb-3 flex flex-wrap items-end gap-3">
				<div className="grid gap-1.5">
					<Label htmlFor="ledger-from" className="text-xs text-muted-foreground">
						From
					</Label>
					<Input
						id="ledger-from"
						type="date"
						className="w-40"
						value={from}
						onChange={(event) => {
							setFrom(event.target.value)
							setOffset(0)
						}}
					/>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor="ledger-to" className="text-xs text-muted-foreground">
						To
					</Label>
					<Input
						id="ledger-to"
						type="date"
						className="w-40"
						value={to}
						onChange={(event) => {
							setTo(event.target.value)
							setOffset(0)
						}}
					/>
				</div>
				<div className="grid gap-1.5">
					<Label htmlFor="ledger-kind" className="text-xs text-muted-foreground">
						Kind
					</Label>
					<Select
						value={kind}
						onValueChange={(value) => {
							setKind(value as "ALL" | CreditEntryKind)
							setOffset(0)
						}}
					>
						<SelectTrigger id="ledger-kind" className="w-40">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="ALL">All kinds</SelectItem>
							<SelectItem value="CHARGE">Charges</SelectItem>
							<SelectItem value="REPAYMENT">Repayments</SelectItem>
							<SelectItem value="REFUND">Refunds</SelectItem>
							<SelectItem value="ADJUSTMENT">Adjustments</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>

			<div className="rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-44">Date</TableHead>
							<TableHead className="w-32">Kind</TableHead>
							<TableHead className="w-40">Reference</TableHead>
							<TableHead className="w-32">Due date</TableHead>
							<TableHead className="w-28 text-right">Amount</TableHead>
							<TableHead
								className="w-32 text-right"
								title="Balance after each entry; anchors to the current balance on the newest page."
							>
								Balance
							</TableHead>
							<TableHead>Note</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{entriesQuery.isLoading ? (
							<TableMessage colSpan={7}>Loading ledger…</TableMessage>
						) : entriesQuery.isError ? (
							<TableMessage colSpan={7} tone="error">
								Couldn't load the ledger.
							</TableMessage>
						) : entries.length === 0 ? (
							<TableMessage colSpan={7}>
								{hasFilters
									? "No ledger entries match these filters."
									: "No credit activity yet at this branch."}
							</TableMessage>
						) : (
							entries.map((entry) => {
								const running = balances?.get(entry.id)
								return (
									<TableRow key={entry.id}>
										<TableCell className="whitespace-nowrap text-muted-foreground">
											{formatDateTime(entry.occurredAt)}
										</TableCell>
										<TableCell>
											<StatusBadge tone={CREDIT_KIND_TONES[entry.kind]}>
												{CREDIT_KIND_LABELS[entry.kind]}
											</StatusBadge>
										</TableCell>
										<TableCell className="font-mono text-xs text-muted-foreground">
											{entry.referenceNumber ?? "—"}
										</TableCell>
										<TableCell className="text-muted-foreground">
											{entry.dueDate ? formatDay(entry.dueDate) : "—"}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{entry.amountMinor < 0 ? (
												<span className="font-medium text-emerald-700">
													{signedGhs(entry.amountMinor)}
												</span>
											) : (
												signedGhs(entry.amountMinor)
											)}
										</TableCell>
										<TableCell className="text-right tabular-nums">
											{running === undefined ? "—" : formatGhs(running)}
										</TableCell>
										<TableCell className="max-w-64">
											{entry.note ? (
												<span className="line-clamp-1 text-muted-foreground" title={entry.note}>
													{entry.note}
												</span>
											) : (
												<span className="text-muted-foreground">—</span>
											)}
										</TableCell>
									</TableRow>
								)
							})
						)}
					</TableBody>
				</Table>
			</div>

			<Pagination total={total} limit={PAGE_SIZE} offset={offset} onOffsetChange={setOffset} />
		</section>
	)
}
