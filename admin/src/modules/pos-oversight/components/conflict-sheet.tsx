import {
	CONFLICT_RESOLUTION_CODES,
	CONFLICT_RESOLUTION_LABELS,
	type ConflictResolutionCode,
	formatDateTime,
	resolutionProblem,
} from "@sceptre/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import { toast } from "sonner"
import { StatusBadge } from "#/components/common/status-badge"
import { Button } from "#/components/ui/button"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "#/components/ui/sheet"
import { Skeleton } from "#/components/ui/skeleton"
import { Textarea } from "#/components/ui/textarea"
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group"
import { ApiError } from "#/lib/api"
import { toastApiError } from "#/lib/toast"
import { posKeys } from "../api/keys"
import { conflictOptions, resolveConflict } from "../api/oversight"
import type { ConflictSubject } from "../types"
import {
	conflictStatusLabel,
	conflictStatusTone,
	conflictTypeLabel,
	detailText,
	resolutionLabel,
	severityLabel,
} from "../utils/labels"

const INLINE_ERROR_STATUSES = new Set([400, 403, 409])

function SubjectLink({ subject }: { subject: ConflictSubject }) {
	if (subject.kind === "sale") {
		return (
			<Link
				to="/pos/sales/$saleId"
				params={{ saleId: subject.id }}
				className="font-mono text-xs hover:underline"
			>
				{subject.receiptNumber}
			</Link>
		)
	}
	if (subject.kind === "shift") {
		return (
			<Link
				to="/pos/shifts/$shiftId"
				params={{ shiftId: subject.id }}
				className="font-mono text-xs hover:underline"
			>
				{subject.number}
			</Link>
		)
	}
	return (
		<span className="text-sm text-muted-foreground">
			No server document: the upload was rejected before a sale existed.
		</span>
	)
}

/**
 * The conflict sheet: what happened, which document it touched, and one decision.
 *
 * The submit button is enabled by the shared `resolutionProblem`, the same function the
 * API validates with, so the console cannot offer a resolution the server refuses. The
 * form says plainly what it does not do: a resolution is a record, never a repair.
 */
export function ConflictSheet({
	conflictId,
	onClose,
	canResolve,
}: {
	conflictId: string | null
	onClose: () => void
	canResolve: boolean
}) {
	const queryClient = useQueryClient()
	const detailQuery = useQuery(conflictOptions(conflictId))
	const [status, setStatus] = useState<"RESOLVED" | "DISMISSED">("RESOLVED")
	const [code, setCode] = useState<ConflictResolutionCode | "">("")
	const [note, setNote] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	// A new conflict starts with a clean form; a stale code would be a decision about
	// the previous document.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the id changes
	useEffect(() => {
		setStatus("RESOLVED")
		setCode("")
		setNote("")
		setFormError(null)
	}, [conflictId])

	const problem = resolutionProblem({ status, code: code || null, note: note || null })

	const mutation = useMutation({
		mutationFn: () =>
			resolveConflict(conflictId as string, {
				status,
				code: code as ConflictResolutionCode,
				...(note.trim().length > 0 ? { note: note.trim() } : {}),
			}),
		onSuccess: async () => {
			toast.success("Conflict closed")
			await queryClient.invalidateQueries({ queryKey: posKeys.all })
			onClose()
		},
		onError: (error) => {
			if (error instanceof ApiError && INLINE_ERROR_STATUSES.has(error.status)) {
				setFormError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	const detail = detailQuery.data
	const denied = detailQuery.error instanceof ApiError && detailQuery.error.status === 403
	const requestId = detailQuery.error instanceof ApiError ? detailQuery.error.requestId : undefined

	return (
		<Sheet open={conflictId !== null} onOpenChange={(open) => (!open ? onClose() : undefined)}>
			<SheetContent className="w-full sm:max-w-md">
				<SheetHeader>
					<SheetTitle>{detail ? conflictTypeLabel(detail.type) : "Conflict"}</SheetTitle>
					<SheetDescription>
						{detail
							? `Raised ${formatDateTime(detail.createdAt)} · ${detail.branchCode} · ${detail.terminalCode}`
							: "The queue row, its document and the decision."}
					</SheetDescription>
				</SheetHeader>

				<div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
					{detailQuery.isLoading ? (
						<div className="grid gap-3" aria-busy="true">
							<output className="sr-only">Loading the conflict</output>
							<Skeleton className="h-20 w-full" />
							<Skeleton className="h-40 w-full" />
						</div>
					) : denied ? (
						<p className="text-sm text-muted-foreground">
							You cannot see this conflict. It belongs to a branch your role does not cover.
						</p>
					) : detailQuery.isError || !detail ? (
						<div className="rounded-md border border-dashed p-3">
							<p className="text-sm text-destructive">
								Couldn't load this conflict.{requestId ? ` Request ${requestId}.` : ""}
							</p>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="mt-2"
								onClick={() => void detailQuery.refetch()}
							>
								Retry
							</Button>
						</div>
					) : (
						<div className="grid gap-4 text-sm">
							<div className="flex flex-wrap items-center gap-2">
								<StatusBadge variant={conflictStatusTone(detail.status)}>
									{conflictStatusLabel(detail.status)}
								</StatusBadge>
								<StatusBadge variant="muted">{severityLabel(detail.severity)} severity</StatusBadge>
								{detail.resolutionCode ? (
									<StatusBadge variant="info">{resolutionLabel(detail.resolutionCode)}</StatusBadge>
								) : null}
							</div>

							<dl className="grid gap-2">
								<div className="flex justify-between gap-3">
									<dt className="text-muted-foreground">Document</dt>
									<dd className="text-right">
										<SubjectLink subject={detail.subject} />
									</dd>
								</div>
								<div className="flex justify-between gap-3">
									<dt className="text-muted-foreground">Branch</dt>
									<dd>{detail.branchCode}</dd>
								</div>
								<div className="flex justify-between gap-3">
									<dt className="text-muted-foreground">Terminal</dt>
									<dd>{detail.terminalCode}</dd>
								</div>
								{detail.resolvedAt ? (
									<div className="flex justify-between gap-3">
										<dt className="text-muted-foreground">Closed</dt>
										<dd>{formatDateTime(detail.resolvedAt)}</dd>
									</div>
								) : null}
							</dl>

							<section className="grid gap-1" aria-labelledby="conflict-details-heading">
								<h3 id="conflict-details-heading" className="font-medium">
									What the till recorded
								</h3>
								{Object.keys(detail.details).length === 0 ? (
									<p className="text-muted-foreground">No structured details were recorded.</p>
								) : (
									<dl className="grid gap-1">
										{Object.entries(detail.details).map(([key, value]) => (
											<div key={key} className="flex justify-between gap-3">
												<dt className="text-muted-foreground">{key}</dt>
												<dd className="max-w-56 break-words text-right">{detailText(value)}</dd>
											</div>
										))}
									</dl>
								)}
							</section>

							{detail.status !== "OPEN" ? (
								<section className="grid gap-1 rounded-md bg-muted/50 p-3" aria-live="polite">
									<p className="font-medium">This conflict is closed.</p>
									<p className="text-muted-foreground">
										{resolutionLabel(detail.resolutionCode)}
										{detail.resolutionNote ? ` — ${detail.resolutionNote}` : ""}
									</p>
								</section>
							) : canResolve ? (
								<form
									className="grid gap-3 border-t pt-3"
									onSubmit={(event) => {
										event.preventDefault()
										setFormError(null)
										if (problem === null) mutation.mutate()
									}}
								>
									<p className="text-xs text-muted-foreground">
										This records a decision. It does not change the sale, the stock or the ledger.
									</p>

									<div className="grid gap-1.5">
										<span className="text-sm font-medium">Decision</span>
										<ToggleGroup
											type="single"
											variant="outline"
											value={status}
											onValueChange={(value) => {
												if (value === "RESOLVED" || value === "DISMISSED") setStatus(value)
											}}
											aria-label="Resolution status"
										>
											<ToggleGroupItem value="RESOLVED">Resolved</ToggleGroupItem>
											<ToggleGroupItem value="DISMISSED">Dismissed</ToggleGroupItem>
										</ToggleGroup>
									</div>

									<div className="grid gap-1.5">
										<Label htmlFor="conflict-code">Code</Label>
										<Select
											value={code}
											onValueChange={(value) => setCode(value as ConflictResolutionCode)}
										>
											<SelectTrigger id="conflict-code" className="w-full">
												<SelectValue placeholder="Choose what happened" />
											</SelectTrigger>
											<SelectContent>
												{CONFLICT_RESOLUTION_CODES.map((resolutionCode) => (
													<SelectItem key={resolutionCode} value={resolutionCode}>
														{CONFLICT_RESOLUTION_LABELS[resolutionCode]}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>

									<div className="grid gap-1.5">
										<Label htmlFor="conflict-note">
											Note{status === "DISMISSED" ? "" : " (optional)"}
										</Label>
										<Textarea
											id="conflict-note"
											rows={3}
											maxLength={500}
											value={note}
											onChange={(event) => setNote(event.target.value)}
											aria-describedby="conflict-problem"
										/>
									</div>

									<p id="conflict-problem" className="text-xs text-muted-foreground">
										{problem ?? "Ready to record."}
									</p>

									{formError ? (
										<p role="alert" className="text-sm text-destructive">
											{formError}
										</p>
									) : null}

									<Button type="submit" disabled={problem !== null || mutation.isPending}>
										{mutation.isPending
											? "Saving…"
											: status === "DISMISSED"
												? "Dismiss conflict"
												: "Resolve conflict"}
									</Button>
								</form>
							) : (
								<p className="rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
									Your role can read the queue but not close a conflict. A decision needs
									conflict.resolve.
								</p>
							)}
						</div>
					)}
				</div>
			</SheetContent>
		</Sheet>
	)
}
