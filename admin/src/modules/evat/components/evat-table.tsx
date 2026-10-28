import { formatCount, formatDateTime, formatDay } from "@sceptre/shared"
import { Link } from "@tanstack/react-router"
import { TableMessage } from "#/components/common/table-message"
import { Button } from "#/components/ui/button"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"
import type { EvatSubmissionPage } from "../types"
import { EVAT_KIND_LABELS } from "./evat-filters"
import { EvatStatusBadge, OverdueBadge } from "./evat-status-badge"

interface BranchOption {
	id: string
	name: string
}

/**
 * One row per document GRA was told about, or will be. The `GRA code` column is our name for
 * whatever came back — a refusal code, or a service code we wrote ourselves — because a blank
 * cell where a refusal should be is the defect this screen exists to prevent.
 */
export function EvatTable({
	page,
	isLoading,
	isError,
	requestId,
	branches,
	showBranch,
	onOpen,
	emptyMessage,
}: {
	page: EvatSubmissionPage | undefined
	isLoading: boolean
	isError: boolean
	requestId: string | undefined
	branches: BranchOption[]
	showBranch: boolean
	onOpen: (submissionId: string) => void
	emptyMessage: string
}) {
	const submissions = page?.submissions ?? []
	const columns = showBranch ? 9 : 8

	return (
		<div className="rounded-lg border bg-card">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Document</TableHead>
						{showBranch ? <TableHead className="w-28">Branch</TableHead> : null}
						<TableHead className="w-32">Created</TableHead>
						<TableHead className="w-40">Due</TableHead>
						<TableHead className="w-36">Status</TableHead>
						<TableHead className="w-20 text-right">Attempts</TableHead>
						<TableHead className="w-36">Next attempt</TableHead>
						<TableHead className="w-28">GRA code</TableHead>
						<TableHead className="w-20 text-right">
							<span className="sr-only">Detail</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{isLoading ? (
						<TableMessage colSpan={columns} state="loading" rows={6}>
							Loading E-VAT submissions…
						</TableMessage>
					) : isError ? (
						<TableMessage colSpan={columns} state="error">
							Couldn&rsquo;t load E-VAT submissions.
							{requestId ? ` Request ${requestId}.` : ""}
						</TableMessage>
					) : submissions.length === 0 ? (
						<TableMessage colSpan={columns}>{emptyMessage}</TableMessage>
					) : (
						submissions.map((submission) => (
							<TableRow key={submission.id}>
								<TableCell>
									<p className="text-xs text-muted-foreground">
										{EVAT_KIND_LABELS[submission.kind]}
									</p>
									{submission.saleId ? (
										<Link
											to="/pos/sales/$saleId"
											params={{ saleId: submission.saleId }}
											className="font-mono text-xs font-medium hover:underline"
										>
											{submission.documentNumber ?? submission.id}
										</Link>
									) : submission.refundId ? (
										<Link
											to="/pos/refunds/$refundId"
											params={{ refundId: submission.refundId }}
											className="font-mono text-xs font-medium hover:underline"
										>
											{submission.documentNumber ?? submission.id}
										</Link>
									) : (
										<span className="font-mono text-xs">{submission.documentNumber ?? "—"}</span>
									)}
								</TableCell>
								{showBranch ? (
									<TableCell className="text-muted-foreground">
										{branches.find((branch) => branch.id === submission.branchId)?.name ?? "—"}
									</TableCell>
								) : null}
								<TableCell className="text-muted-foreground">
									{formatDay(submission.createdAt)}
								</TableCell>
								<TableCell>
									<p className="text-muted-foreground">{formatDateTime(submission.dueAt)}</p>
									<OverdueBadge overdue={submission.overdue} />
								</TableCell>
								<TableCell>
									<EvatStatusBadge status={submission.status} />
								</TableCell>
								<TableCell className="text-right tabular-nums">
									{formatCount(submission.attempts)}
								</TableCell>
								<TableCell className="text-muted-foreground">
									{submission.nextAttemptAt ? formatDateTime(submission.nextAttemptAt) : "—"}
								</TableCell>
								<TableCell>
									{submission.lastErrorCode ? (
										<span className="font-mono text-xs">{submission.lastErrorCode}</span>
									) : submission.lastErrorMessage ? (
										<span className="text-xs text-destructive">Refused</span>
									) : (
										<span className="text-muted-foreground">—</span>
									)}
								</TableCell>
								<TableCell className="text-right">
									<Button
										variant="ghost"
										size="sm"
										aria-label={`Open submission ${submission.documentNumber ?? submission.id}`}
										onClick={() => onOpen(submission.id)}
									>
										Open
									</Button>
								</TableCell>
							</TableRow>
						))
					)}
				</TableBody>
			</Table>
		</div>
	)
}
