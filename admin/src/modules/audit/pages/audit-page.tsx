import { formatDateTime } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { cn } from "cn"
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react"
import { useState } from "react"
import { CopyButton } from "#/components/common/copy-button"
import { PageHeader } from "#/components/common/page-header"
import { Pagination } from "#/components/common/pagination"
import { TableMessage } from "#/components/common/table-message"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { useBranch } from "#/lib/branch-context"
import { useDebouncedValue } from "#/lib/hooks"
import { auditListOptions } from "../api/audit"
import type { AuditEntry } from "../types"
import { diffRows, isRecord } from "../utils/diff"

const PAGE_SIZE = 25

export function AuditPage() {
	const { activeBranchId, branches } = useBranch()

	const [action, setAction] = useState("")
	const [entity, setEntity] = useState("")
	const [actorStaffId, setActorStaffId] = useState("")
	const [from, setFrom] = useState("")
	const [to, setTo] = useState("")
	const [offset, setOffset] = useState(0)
	const [expandedId, setExpandedId] = useState<string | null>(null)

	const debouncedAction = useDebouncedValue(action, 300)
	const debouncedEntity = useDebouncedValue(entity, 300)
	const debouncedActor = useDebouncedValue(actorStaffId, 300)

	// Reset pagination whenever the filters change (derived state, no effect).
	const filterSignature = JSON.stringify([
		debouncedAction,
		debouncedEntity,
		debouncedActor,
		from,
		to,
		activeBranchId,
	])
	const [lastFilterSignature, setLastFilterSignature] = useState(filterSignature)
	if (filterSignature !== lastFilterSignature) {
		setLastFilterSignature(filterSignature)
		setOffset(0)
	}

	const auditQuery = useQuery(
		auditListOptions({
			action: debouncedAction || undefined,
			entity: debouncedEntity || undefined,
			actorStaffId: debouncedActor || undefined,
			from: from ? new Date(from).toISOString() : undefined,
			to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
			branchId: activeBranchId ?? undefined,
			limit: PAGE_SIZE,
			offset,
		}),
	)

	const entries = auditQuery.data?.entries ?? []
	const total = auditQuery.data?.total ?? 0
	const branchCode = (branchId: string | null) =>
		branchId ? (branches.find((branch) => branch.id === branchId)?.code ?? "—") : "—"

	return (
		<div>
			<PageHeader title="Audit log" description="Every change made in the console, newest first." />

			<div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
				<div className="grid gap-1">
					<Label htmlFor="audit-action" className="text-xs text-muted-foreground">
						Action
					</Label>
					<Input
						id="audit-action"
						placeholder="branch.created"
						className="h-8 font-mono text-xs"
						value={action}
						onChange={(event) => setAction(event.target.value)}
					/>
				</div>
				<div className="grid gap-1">
					<Label htmlFor="audit-entity" className="text-xs text-muted-foreground">
						Entity
					</Label>
					<Input
						id="audit-entity"
						placeholder="branch"
						className="h-8 font-mono text-xs"
						value={entity}
						onChange={(event) => setEntity(event.target.value)}
					/>
				</div>
				<div className="grid gap-1">
					<Label htmlFor="audit-actor" className="text-xs text-muted-foreground">
						Actor ID
					</Label>
					<Input
						id="audit-actor"
						placeholder="GA-0001"
						className="h-8 font-mono text-xs"
						value={actorStaffId}
						onChange={(event) => setActorStaffId(event.target.value)}
					/>
				</div>
				<div className="grid gap-1">
					<Label htmlFor="audit-from" className="text-xs text-muted-foreground">
						From
					</Label>
					<Input
						id="audit-from"
						type="date"
						className="h-8"
						value={from}
						onChange={(event) => setFrom(event.target.value)}
					/>
				</div>
				<div className="grid gap-1">
					<Label htmlFor="audit-to" className="text-xs text-muted-foreground">
						To
					</Label>
					<Input
						id="audit-to"
						type="date"
						className="h-8"
						value={to}
						onChange={(event) => setTo(event.target.value)}
					/>
				</div>
			</div>

			<div className="rounded-lg border bg-card">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead className="w-10" />
							<TableHead className="w-44">Time</TableHead>
							<TableHead>Action</TableHead>
							<TableHead className="w-28">Entity</TableHead>
							<TableHead className="w-24">Actor</TableHead>
							<TableHead className="w-24">Branch</TableHead>
							<TableHead className="w-36">Request ID</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{auditQuery.isLoading ? (
							<TableMessage colSpan={7}>Loading audit entries…</TableMessage>
						) : auditQuery.isError ? (
							<TableMessage colSpan={7} tone="error">
								Couldn't load the audit log.
							</TableMessage>
						) : entries.length === 0 ? (
							<TableMessage colSpan={7}>No entries match these filters.</TableMessage>
						) : (
							entries.map((entry) => (
								<AuditRow
									key={entry.id}
									entry={entry}
									branchCode={branchCode(entry.branchId)}
									expanded={expandedId === entry.id}
									onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
								/>
							))
						)}
					</TableBody>
				</Table>
				<div className="border-t px-3">
					<Pagination total={total} limit={PAGE_SIZE} offset={offset} onOffsetChange={setOffset} />
				</div>
			</div>
		</div>
	)
}

function AuditRow({
	entry,
	branchCode,
	expanded,
	onToggle,
}: {
	entry: AuditEntry
	branchCode: string
	expanded: boolean
	onToggle: () => void
}) {
	const hasDetail = entry.before !== null || entry.after !== null

	return (
		<>
			<TableRow className="cursor-pointer" onClick={hasDetail ? onToggle : undefined}>
				<TableCell>
					{hasDetail ? (
						<Button variant="ghost" size="icon-xs" aria-label={expanded ? "Collapse" : "Expand"}>
							{expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
						</Button>
					) : null}
				</TableCell>
				<TableCell className="text-muted-foreground">{formatDateTime(entry.createdAt)}</TableCell>
				<TableCell className="font-mono text-xs">{entry.action}</TableCell>
				<TableCell className="text-muted-foreground">{entry.entity}</TableCell>
				<TableCell className="font-mono text-xs text-muted-foreground">
					{entry.actorStaffId ?? "system"}
				</TableCell>
				<TableCell className="font-mono text-xs text-muted-foreground">{branchCode}</TableCell>
				<TableCell>
					{entry.requestId ? (
						<span className="flex items-center gap-1">
							<span className="max-w-24 truncate font-mono text-xs text-muted-foreground">
								{entry.requestId}
							</span>
							<CopyButton value={entry.requestId} label="" className="h-6 px-1.5" />
						</span>
					) : (
						<span className="text-muted-foreground">—</span>
					)}
				</TableCell>
			</TableRow>
			{expanded && hasDetail ? (
				<TableRow>
					<TableCell colSpan={7} className="bg-muted/30 p-4">
						<DiffView before={entry.before} after={entry.after} />
					</TableCell>
				</TableRow>
			) : null}
		</>
	)
}

function DiffView({ before, after }: { before: unknown; after: unknown }) {
	if (!isRecord(before) || !isRecord(after)) {
		return (
			<div className="grid grid-cols-2 gap-4 text-xs">
				<div>
					<p className="mb-1 font-medium text-muted-foreground">Before</p>
					<pre className="overflow-auto rounded border bg-background p-2">
						{JSON.stringify(before, null, 2) ?? "—"}
					</pre>
				</div>
				<div>
					<p className="mb-1 font-medium text-muted-foreground">After</p>
					<pre className="overflow-auto rounded border bg-background p-2">
						{JSON.stringify(after, null, 2) ?? "—"}
					</pre>
				</div>
			</div>
		)
	}

	return (
		<div className="overflow-hidden rounded border bg-background text-xs">
			<table className="w-full">
				<thead>
					<tr className="border-b bg-muted/40 text-left">
						<th className="w-40 px-3 py-1.5 font-medium">Field</th>
						<th className="px-3 py-1.5 font-medium">Before</th>
						<th className="px-3 py-1.5 font-medium">After</th>
					</tr>
				</thead>
				<tbody>
					{diffRows(before, after).map((row) => (
						<tr
							key={row.key}
							className={cn("border-b last:border-0", row.changed && "bg-amber-50")}
						>
							<td className="px-3 py-1.5 font-mono">{row.key}</td>
							<td className="px-3 py-1.5 font-mono break-all text-muted-foreground">
								{row.before ?? "—"}
							</td>
							<td className="px-3 py-1.5 font-mono break-all">{row.after ?? "—"}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	)
}
