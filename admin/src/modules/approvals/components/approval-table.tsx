import { formatDay } from "@sceptre/shared"
import { Link } from "@tanstack/react-router"
import { StatusBadge } from "#/components/common/status-badge"
import { TableMessage } from "#/components/common/table-message"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import { useBranch } from "#/lib/branch-context"
import type { ApprovalListResult } from "../types"
import {
	ageWords,
	amountText,
	statusLabel,
	statusTone,
	subjectSummary,
	typeLabel,
	valueLabel,
} from "../utils/approval"

const COLUMNS = 8

export function ApprovalTable({
	result,
	isLoading,
	isError,
	emptyMessage,
}: {
	result: ApprovalListResult | undefined
	isLoading: boolean
	isError: boolean
	emptyMessage: string
}) {
	const { branches } = useBranch()
	const rows = result?.approvals ?? []

	const branchName = (branchId: string) =>
		branches.find((branch) => branch.id === branchId)?.name ?? "Branch"

	return (
		<div className="min-w-0 rounded-md border">
			<Table className="min-w-[58rem]">
				<TableHeader>
					<TableRow>
						<TableHead>Type</TableHead>
						<TableHead>Request</TableHead>
						<TableHead>Branch</TableHead>
						<TableHead className="text-right">Value</TableHead>
						<TableHead>Requester</TableHead>
						<TableHead>Waiting</TableHead>
						<TableHead>Status</TableHead>
						<TableHead className="w-16" />
					</TableRow>
				</TableHeader>
				<TableBody>
					{isLoading ? (
						<TableMessage colSpan={COLUMNS} state="loading" rows={5}>
							Loading the inbox…
						</TableMessage>
					) : isError ? (
						<TableMessage colSpan={COLUMNS} state="error">
							Couldn't load the inbox.
						</TableMessage>
					) : rows.length === 0 ? (
						<TableMessage colSpan={COLUMNS} state="empty">
							{emptyMessage}
						</TableMessage>
					) : (
						rows.map((row) => {
							const summary = subjectSummary(row)
							return (
								<TableRow key={row.id}>
									<TableCell className="whitespace-nowrap font-medium">
										{typeLabel(row.type)}
									</TableCell>
									<TableCell className="max-w-64 truncate">
										<Link
											to="/approvals/$approvalId"
											params={{ approvalId: row.id }}
											className="font-medium text-primary hover:underline"
											aria-label={`View ${typeLabel(row.type)} request: ${summary}`}
										>
											{summary}
										</Link>
									</TableCell>
									<TableCell className="whitespace-nowrap text-muted-foreground">
										{branchName(row.branchId)}
									</TableCell>
									<TableCell className="text-right whitespace-nowrap">
										<span className="tabular-nums">{amountText(row.amountMinor)}</span>
										<span className="block text-xs text-muted-foreground">
											{valueLabel(row.type)}
										</span>
									</TableCell>
									<TableCell className="whitespace-nowrap text-muted-foreground">
										{row.requestedBy}
									</TableCell>
									<TableCell className="whitespace-nowrap text-muted-foreground">
										<time dateTime={row.requestedAt} title={formatDay(row.requestedAt)}>
											{ageWords(row.requestedAt)}
										</time>
									</TableCell>
									<TableCell>
										<StatusBadge variant={statusTone(row.status)}>
											{statusLabel(row.status)}
										</StatusBadge>
									</TableCell>
									<TableCell>
										<Link
											to="/approvals/$approvalId"
											params={{ approvalId: row.id }}
											className="text-sm font-medium text-primary hover:underline"
											aria-label={`View ${typeLabel(row.type)} request`}
										>
											View
										</Link>
									</TableCell>
								</TableRow>
							)
						})
					)}
				</TableBody>
			</Table>
		</div>
	)
}
