import { APPROVAL_REASON_CODES, type ApprovalReasonCode, formatDay } from "@sceptre/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { Button } from "#/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog"
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
import { Textarea } from "#/components/ui/textarea"
import { ApiError } from "#/lib/api"
import { useBranch } from "#/lib/branch-context"
import { formatGhs } from "#/lib/format"
import { toastApiError } from "#/lib/toast"
import { approvalKeys } from "../api/keys"
import { approvalDetailOptions, approvalListOptions, decideApproval } from "../api/approvals"
import {
	APPROVAL_REASON_LABELS,
	proposalName,
	proposalPriceMinor,
	proposalText,
} from "../utils/approval"

/**
 * The pending `PRODUCT_CREATE` queue, shown on the catalogue's product list to an approver.
 *
 * A manager's submission is an approval, not a product (P11-D7), so this is the only screen where
 * it can become one. The list carries the proposal already; the review dialog re-reads the
 * approval so the decision is made against the server's `canDecide`, never a client guess.
 */
export function PendingProductSubmissions({ onDecided }: { onDecided?: () => void }) {
	const { branches } = useBranch()
	const [reviewId, setReviewId] = useState<string | null>(null)

	const approvalsQuery = useQuery(
		approvalListOptions({ type: "PRODUCT_CREATE", status: "PENDING", limit: 20, offset: 0 }),
	)
	const approvals = approvalsQuery.data?.approvals ?? []

	function branchName(branchId: string): string {
		return branches.find((branch) => branch.id === branchId)?.name ?? "Branch"
	}

	return (
		<Card className="mb-4">
			<CardHeader>
				<CardTitle>Pending product submissions</CardTitle>
				<CardDescription>
					A manager's proposal becomes a product only when an administrator approves it.
				</CardDescription>
			</CardHeader>
			<CardContent>
				{approvalsQuery.isLoading ? (
					<p className="text-sm text-muted-foreground">Loading pending submissions…</p>
				) : approvalsQuery.isError ? (
					<p role="alert" className="text-sm text-destructive">
						Couldn't load pending product submissions.
					</p>
				) : approvals.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						No product submissions are waiting for a decision.
					</p>
				) : (
					<div className="overflow-x-auto rounded-lg border">
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead>Proposed product</TableHead>
									<TableHead className="w-32 text-right">Proposed price</TableHead>
									<TableHead className="w-44">Requester</TableHead>
									<TableHead className="w-32">Branch</TableHead>
									<TableHead className="w-28">Requested</TableHead>
									<TableHead className="w-24" />
								</TableRow>
							</TableHeader>
							<TableBody>
								{approvals.map((approval) => {
									const priceMinor = proposalPriceMinor(approval)
									return (
										<TableRow key={approval.id}>
											<TableCell className="font-medium">
												{proposalName(approval.payload)}
											</TableCell>
											<TableCell className="text-right tabular-nums">
												{priceMinor === null ? "—" : formatGhs(priceMinor)}
											</TableCell>
											<TableCell className="text-muted-foreground">
												{approval.requestedBy}
											</TableCell>
											<TableCell className="text-muted-foreground">
												{branchName(approval.branchId)}
											</TableCell>
											<TableCell className="text-muted-foreground">
												{formatDay(approval.requestedAt)}
											</TableCell>
											<TableCell className="text-right">
												<Button
													size="sm"
													variant="ghost"
													onClick={() => setReviewId(approval.id)}
												>
													Review
												</Button>
											</TableCell>
										</TableRow>
									)
								})}
							</TableBody>
						</Table>
					</div>
				)}
			</CardContent>

			{reviewId ? (
				<ReviewDialog
					approvalId={reviewId}
					onClose={() => setReviewId(null)}
					onDecided={onDecided}
				/>
			) : null}
		</Card>
	)
}

function ReviewDialog({
	approvalId,
	onClose,
	onDecided,
}: {
	approvalId: string
	onClose: () => void
	onDecided?: () => void
}) {
	const queryClient = useQueryClient()
	const { branches } = useBranch()
	const [reasonCode, setReasonCode] = useState<ApprovalReasonCode | "">("")
	const [note, setNote] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	const detailQuery = useQuery(approvalDetailOptions(approvalId))
	const detail = detailQuery.data
	const approval = detail?.approval
	const proposal = detail?.subject.kind === "product" ? detail.subject.proposal : null

	const decideMutation = useMutation({
		mutationFn: (decision: "APPROVED" | "REJECTED") =>
			decideApproval(approvalId, {
				decision,
				...(decision === "REJECTED" && reasonCode ? { reasonCode } : {}),
				...(note.trim() ? { note: note.trim() } : {}),
			}),
		onSuccess: async (data) => {
			toast.success(
				data.approval.status === "APPROVED"
					? "Product approved — it is now in the catalogue"
					: "Product submission rejected",
			)
			await queryClient.invalidateQueries({ queryKey: approvalKeys.all })
			onDecided?.()
			onClose()
		},
		onError: (error) => {
			if (
				error instanceof ApiError &&
				(error.status === 400 || error.status === 403 || error.status === 409)
			) {
				setFormError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	const branchName = approval
		? (branches.find((branch) => branch.id === approval.branchId)?.name ?? "Branch")
		: "Branch"
	const proposedPriceMinor = approval ? proposalPriceMinor(approval) : null

	return (
		<Dialog
			open
			onOpenChange={(next) => {
				if (!next) onClose()
			}}
		>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Product submission</DialogTitle>
					<DialogDescription>
						Approving creates the product in the catalogue. Rejecting needs a reason code.
					</DialogDescription>
				</DialogHeader>

				{detailQuery.isLoading ? (
					<p className="text-sm text-muted-foreground">Loading submission…</p>
				) : detailQuery.isError || !detail || !approval ? (
					<p role="alert" className="text-sm text-destructive">
						Couldn't load this submission.
					</p>
				) : (
					<div className="grid gap-4">
						<dl className="grid gap-2 text-sm">
							<div className="flex justify-between gap-4">
								<dt className="text-muted-foreground">Name</dt>
								<dd className="text-right font-medium">
									{proposal ? proposalName(proposal) : proposalName(approval.payload)}
								</dd>
							</div>
							<div className="flex justify-between gap-4">
								<dt className="text-muted-foreground">Proposed selling price</dt>
								<dd className="text-right font-medium tabular-nums">
									{proposedPriceMinor === null ? "—" : formatGhs(proposedPriceMinor)}
								</dd>
							</div>
							{proposal && proposalText(proposal, "description") ? (
								<div className="flex justify-between gap-4">
									<dt className="text-muted-foreground">Description</dt>
									<dd className="max-w-64 text-right">
										{proposalText(proposal, "description")}
									</dd>
								</div>
							) : null}
							<div className="flex justify-between gap-4">
								<dt className="text-muted-foreground">Requested by</dt>
								<dd className="text-right">{approval.requestedBy}</dd>
							</div>
							<div className="flex justify-between gap-4">
								<dt className="text-muted-foreground">Branch</dt>
								<dd className="text-right">{branchName}</dd>
							</div>
							<div className="flex justify-between gap-4">
								<dt className="text-muted-foreground">Requested</dt>
								<dd className="text-right">{formatDay(approval.requestedAt)}</dd>
							</div>
							{approval.requestNote ? (
								<div className="flex justify-between gap-4">
									<dt className="text-muted-foreground">Requester's note</dt>
									<dd className="max-w-64 text-right">{approval.requestNote}</dd>
								</div>
							) : null}
						</dl>

						{detail.canDecide ? (
							<div className="grid gap-3 rounded-md border bg-muted/30 p-3">
								<div className="grid gap-1.5">
									<Label htmlFor="submission-reason">
										Reason (required to reject)
									</Label>
									<Select
										value={reasonCode || undefined}
										onValueChange={(value) => setReasonCode(value as ApprovalReasonCode)}
									>
										<SelectTrigger id="submission-reason" className="w-full">
											<SelectValue placeholder="Optional when approving" />
										</SelectTrigger>
										<SelectContent>
											{APPROVAL_REASON_CODES.map((code) => (
												<SelectItem key={code} value={code}>
													{APPROVAL_REASON_LABELS[code]}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>

								<div className="grid gap-1.5">
									<Label htmlFor="submission-note">Note (optional)</Label>
									<Textarea
										id="submission-note"
										rows={2}
										maxLength={300}
										value={note}
										onChange={(event) => setNote(event.target.value)}
									/>
								</div>

								{formError ? (
									<p role="alert" className="text-sm text-destructive">
										{formError}
									</p>
								) : null}

								<div className="flex flex-wrap gap-2">
									<Button
										size="sm"
										disabled={decideMutation.isPending}
										onClick={() => {
											setFormError(null)
											decideMutation.mutate("APPROVED")
										}}
									>
										{decideMutation.isPending ? "Saving…" : "Approve product"}
									</Button>
									<Button
										size="sm"
										variant="outline"
										className="text-destructive hover:text-destructive"
										disabled={decideMutation.isPending}
										onClick={() => {
											setFormError(null)
											if (!reasonCode) {
												setFormError("Choose a reason code before rejecting.")
												return
											}
											decideMutation.mutate("REJECTED")
										}}
									>
										Reject
									</Button>
								</div>
							</div>
						) : (
							<p className="text-sm text-muted-foreground">
								You cannot decide this request. An administrator other than the requester
								decides it.
							</p>
						)}
					</div>
				)}

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={onClose}
						disabled={decideMutation.isPending}
					>
						Close
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
