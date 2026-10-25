import {
	APPROVAL_REASON_CODES,
	type ApprovalReasonCode,
	formatDay,
} from "@sceptre/shared"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { StatusBadge } from "#/components/common/status-badge"
import { Button } from "#/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { Label } from "#/components/ui/label"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { Textarea } from "#/components/ui/textarea"
import { ApiError } from "#/lib/api"
import { formatGhs } from "#/lib/format"
import { hasPermission } from "#/lib/role"
import { toastApiError } from "#/lib/toast"
import { approvalKeys, orderKeys } from "../api/keys"
import { approvalDetailOptions, decideApproval } from "../api/approvals"
import type { OrderDetail } from "../types"

const REASON_LABELS: Record<ApprovalReasonCode, string> = {
	OVER_THRESHOLD: "Over the threshold",
	PRICE_TOO_HIGH: "Price too high",
	OUT_OF_POLICY: "Out of policy",
	INCOMPLETE: "Incomplete",
	DUPLICATE: "Duplicate",
	OTHER: "Other",
}

const THRESHOLD_SOURCE: Record<OrderDetail["threshold"]["source"], string> = {
	branch: "branch limit",
	global: "global limit",
	default: "default limit",
}

function reasonLabel(code: ApprovalReasonCode | null): string {
	return code ? REASON_LABELS[code] : "no reason recorded"
}

/**
 * The pending decision on an order, and the sentence that says who decided what.
 *
 * Approve/reject are rendered only when the actor holds `procurement.approve` **and** the server's
 * `canDecide` is true, which also covers the self-approval rule: nobody decides their own request.
 */
export function ApprovalPanel({ detail, role }: { detail: OrderDetail; role: string }) {
	const queryClient = useQueryClient()
	const approval = detail.approval
	const canApprove = hasPermission(role, "procurement.approve")
	const pending = approval?.status === "PENDING"

	const decisionQuery = useQuery({
		...approvalDetailOptions(pending && canApprove ? approval.id : null),
		retry: false,
	})

	const [reasonCode, setReasonCode] = useState<ApprovalReasonCode | "">("")
	const [note, setNote] = useState("")
	const [actionError, setActionError] = useState<string | null>(null)

	const decideMutation = useMutation({
		mutationFn: (decision: "APPROVED" | "REJECTED") =>
			decideApproval(approval?.id as string, {
				decision,
				...(decision === "REJECTED" && reasonCode ? { reasonCode } : {}),
				...(note.trim() ? { note: note.trim() } : {}),
			}),
		onSuccess: async (data) => {
			toast.success(
				data.approval.status === "APPROVED" ? "Order approved" : "Order rejected",
			)
			setNote("")
			setReasonCode("")
			await Promise.all([
				queryClient.invalidateQueries({ queryKey: approvalKeys.all }),
				queryClient.invalidateQueries({ queryKey: orderKeys.byId(detail.order.id) }),
				queryClient.invalidateQueries({ queryKey: orderKeys.all }),
			])
		},
		onError: (error) => {
			if (error instanceof ApiError && (error.status === 400 || error.status === 409 || error.status === 403)) {
				setActionError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	const limit = `Approval limit ${formatGhs(detail.threshold.valueMinor)} (${THRESHOLD_SOURCE[detail.threshold.source]}).`

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex flex-wrap items-center gap-2">
					Approval
					{pending ? <StatusBadge variant="warn">Awaiting decision</StatusBadge> : null}
				</CardTitle>
				<CardDescription>{limit}</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-3 text-sm">
				<p>
					Goods value (ex-tax):{" "}
					<span className="font-medium tabular-nums">{formatGhs(detail.goodsValueMinor)}</span>
				</p>

				{approval === null ? (
					<p className="text-muted-foreground">
						{detail.order.status === "DRAFT"
							? `Submitting this order compares its goods value with the ${THRESHOLD_SOURCE[detail.threshold.source]}.`
							: `${limit} This order was approved automatically.`}
					</p>
				) : approval.status === "PENDING" ? (
					<>
						<p className="text-muted-foreground">
							Awaiting admin approval. Requested by {approval.requestedBy}. The goods value is at or
							above the limit.
						</p>

						{canApprove ? (
							decisionQuery.isLoading ? (
								<p className="text-muted-foreground">Loading the decision…</p>
							) : decisionQuery.isError ? (
								<p role="alert" className="text-destructive">
									Couldn't load this decision.
								</p>
							) : decisionQuery.data && !decisionQuery.data.canDecide ? (
								<p className="text-muted-foreground">
									You cannot decide this request. A request is decided by an administrator other
									than the person who raised it.
								</p>
							) : decisionQuery.data ? (
								<div className="grid gap-3 rounded-md border bg-muted/30 p-3">
									<div className="grid gap-1.5 sm:max-w-xs">
										<Label htmlFor="approval-reason">Reason (required to reject)</Label>
										<Select
											value={reasonCode || undefined}
											onValueChange={(value) => setReasonCode(value as ApprovalReasonCode)}
										>
											<SelectTrigger id="approval-reason" className="w-full">
												<SelectValue placeholder="Optional when approving" />
											</SelectTrigger>
											<SelectContent>
												{APPROVAL_REASON_CODES.map((code) => (
													<SelectItem key={code} value={code}>
														{REASON_LABELS[code]}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
									</div>

									<div className="grid gap-1.5">
										<Label htmlFor="approval-note">Note (optional)</Label>
										<Textarea
											id="approval-note"
											rows={2}
											maxLength={300}
											value={note}
											onChange={(event) => setNote(event.target.value)}
										/>
									</div>

									{actionError ? (
										<p role="alert" className="text-sm text-destructive">
											{actionError}
										</p>
									) : null}

									<div className="flex flex-wrap gap-2">
										<Button
											size="sm"
											disabled={decideMutation.isPending}
											onClick={() => {
												setActionError(null)
												decideMutation.mutate("APPROVED")
											}}
										>
											{decideMutation.isPending ? "Saving…" : "Approve order"}
										</Button>
										<Button
											size="sm"
											variant="outline"
											className="text-destructive hover:text-destructive"
											disabled={decideMutation.isPending}
											onClick={() => {
												setActionError(null)
												if (!reasonCode) {
													setActionError("Choose a reason code before rejecting.")
													return
												}
												decideMutation.mutate("REJECTED")
											}}
										>
											Reject order
										</Button>
									</div>
								</div>
							) : null
						) : (
							<p className="text-muted-foreground">
								Awaiting an administrator's decision. You can watch this order but not decide it.
							</p>
						)}
					</>
				) : approval.status === "APPROVED" ? (
					<p className="text-muted-foreground">
						Approved by {approval.decidedBy ?? "an administrator"}
						{approval.decidedAt ? ` on ${formatDay(approval.decidedAt)}` : ""}.
					</p>
				) : approval.status === "REJECTED" ? (
					<p className="text-muted-foreground">
						Rejected by {approval.decidedBy ?? "an administrator"}
						{approval.decidedAt ? ` on ${formatDay(approval.decidedAt)}` : ""} —{" "}
						{reasonLabel(approval.decisionReasonCode)}.
					</p>
				) : (
					<p className="text-muted-foreground">The requester withdrew this request.</p>
				)}
			</CardContent>
		</Card>
	)
}
