import { formatDateTime } from "@sceptre/shared"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "#/components/common/confirm-dialog"
import { StatusBadge } from "#/components/common/status-badge"
import { Button } from "#/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { useBranch } from "#/lib/branch-context"
import { toastApiError } from "#/lib/toast"
import { withdrawApproval } from "../api/approvals"
import { approvalKeys } from "../api/keys"
import type { ApprovalDetail, ApprovalSubject } from "../types"
import {
	ageWords,
	amountText,
	approvalReasonLabel,
	statusLabel,
	statusTone,
	typeLabel,
	valueLabel,
} from "../utils/approval"
import { DecisionDialog } from "./decision-dialog"
import { CreditSubject } from "./subject/credit-subject"
import { PriceSubject } from "./subject/price-subject"
import { ProductSubject } from "./subject/product-subject"
import { PurchaseOrderSubject } from "./subject/purchase-order-subject"
import { RefundSubject } from "./subject/refund-subject"
import { ShiftSubject } from "./subject/shift-subject"
import { TransferSubject } from "./subject/transfer-subject"
import { WriteOffSubject } from "./subject/write-off-subject"

function Subject({
	subject,
	amountMinor,
	branchId,
	requestedBy,
	requestNote,
}: {
	subject: ApprovalSubject
	amountMinor: number | null
	branchId: string
	requestedBy: string
	requestNote: string | null
}) {
	switch (subject.kind) {
		case "purchase_order":
			return <PurchaseOrderSubject subject={subject} amountMinor={amountMinor} />
		case "product":
			return <ProductSubject subject={subject} />
		case "transfer":
			return <TransferSubject subject={subject} amountMinor={amountMinor} />
		case "stock_write_off":
			return <WriteOffSubject subject={subject} amountMinor={amountMinor} />
		case "price_change":
			return <PriceSubject subject={subject} />
		case "credit_limit_change":
			return <CreditSubject subject={subject} />
		case "shift_variance":
			return <ShiftSubject subject={subject} />
		case "refund":
			return (
				<RefundSubject
					subject={subject}
					branchId={branchId}
					cashier={requestedBy}
					note={requestNote}
				/>
			)
		default:
			return (
				<Card>
					<CardHeader>
						<CardTitle>Evidence not yet available</CardTitle>
						<CardDescription>
							This request type has no console renderer yet. The decision is still recorded against
							the request and its audit trail.
						</CardDescription>
					</CardHeader>
				</Card>
			)
	}
}

/**
 * The decision's whole evidence: what is being asked, who asked, what it is worth, and the
 * server's answer to "may this actor decide it".
 *
 * `canDecide` and `canWithdraw` are the API's fields. The console never infers them from the
 * role: a manager may only decide their own branch, never their own request, and a variance
 * review records an outcome instead of approving or rejecting.
 */
export function ApprovalDetailPanel({ detail }: { detail: ApprovalDetail }) {
	const { approval, subject, canDecide, canWithdraw } = detail
	const { branches } = useBranch()
	const queryClient = useQueryClient()
	const [withdrawOpen, setWithdrawOpen] = useState(false)

	const pending = approval.status === "PENDING"
	const variance = approval.type === "SHIFT_VARIANCE_REVIEW"
	const branchName = branches.find((branch) => branch.id === approval.branchId)?.name ?? "Branch"

	const withdraw = useMutation({
		mutationFn: () => withdrawApproval(approval.id),
		onSuccess: async () => {
			toast.success("Request withdrawn")
			setWithdrawOpen(false)
			await queryClient.invalidateQueries({ queryKey: approvalKeys.all })
		},
		onError: (error) => {
			setWithdrawOpen(false)
			toastApiError(error)
		},
	})

	return (
		<div className="grid gap-4">
			<Card>
				<CardHeader>
					<CardTitle className="flex flex-wrap items-center gap-2">
						{typeLabel(approval.type)}
						<StatusBadge variant={statusTone(approval.status)}>
							{statusLabel(approval.status)}
						</StatusBadge>
					</CardTitle>
					<CardDescription>
						Requested by {approval.requestedBy} at {branchName} ·{" "}
						<time dateTime={approval.requestedAt} title={formatDateTime(approval.requestedAt)}>
							{ageWords(approval.requestedAt)}
						</time>
					</CardDescription>
				</CardHeader>
				<CardContent>
					<dl className="grid gap-2 text-sm">
						<div className="flex flex-wrap justify-between gap-2">
							<dt className="text-muted-foreground">{valueLabel(approval.type)}</dt>
							<dd className="font-medium tabular-nums">{amountText(approval.amountMinor)}</dd>
						</div>
						{approval.requestNote ? (
							<div className="flex flex-wrap justify-between gap-2">
								<dt className="text-muted-foreground">Requester's note</dt>
								<dd className="max-w-96 text-right">{approval.requestNote}</dd>
							</div>
						) : null}
					</dl>
				</CardContent>
			</Card>

			<Subject
				subject={subject}
				amountMinor={approval.amountMinor}
				branchId={approval.branchId}
				requestedBy={approval.requestedBy}
				requestNote={approval.requestNote}
			/>

			<Card>
				<CardHeader>
					<CardTitle>Audit trail</CardTitle>
				</CardHeader>
				<CardContent>
					<dl className="grid gap-2 text-sm">
						<div className="flex flex-wrap justify-between gap-2">
							<dt className="text-muted-foreground">Requested</dt>
							<dd>{formatDateTime(approval.requestedAt)}</dd>
						</div>
						{approval.status === "PENDING" ? (
							<div className="flex flex-wrap justify-between gap-2">
								<dt className="text-muted-foreground">Outcome</dt>
								<dd>Still waiting for a decision</dd>
							</div>
						) : approval.status === "WITHDRAWN" ? (
							<div className="flex flex-wrap justify-between gap-2">
								<dt className="text-muted-foreground">Outcome</dt>
								<dd>Withdrawn by the requester</dd>
							</div>
						) : (
							<>
								<div className="flex flex-wrap justify-between gap-2">
									<dt className="text-muted-foreground">Decided by</dt>
									<dd>{approval.decidedBy ?? "—"}</dd>
								</div>
								<div className="flex flex-wrap justify-between gap-2">
									<dt className="text-muted-foreground">Decided</dt>
									<dd>{approval.decidedAt ? formatDateTime(approval.decidedAt) : "—"}</dd>
								</div>
								<div className="flex flex-wrap justify-between gap-2">
									<dt className="text-muted-foreground">Reason</dt>
									<dd>{approvalReasonLabel(approval.decisionReasonCode)}</dd>
								</div>
								{approval.decisionNote ? (
									<div className="flex flex-wrap justify-between gap-2">
										<dt className="text-muted-foreground">Decision note</dt>
										<dd className="max-w-96 text-right">{approval.decisionNote}</dd>
									</div>
								) : null}
							</>
						)}
					</dl>
				</CardContent>
			</Card>

			{pending ? (
				<>
					<div className="flex flex-wrap items-center gap-2">
						{canDecide ? (
							variance ? (
								<DecisionDialog
									approvalId={approval.id}
									type={approval.type}
									decision="APPROVED"
									trigger={<Button type="button">Record outcome</Button>}
								/>
							) : (
								<>
									<DecisionDialog
										approvalId={approval.id}
										type={approval.type}
										decision="APPROVED"
										trigger={<Button type="button">Approve</Button>}
									/>
									<DecisionDialog
										approvalId={approval.id}
										type={approval.type}
										decision="REJECTED"
										trigger={
											<Button
												type="button"
												variant="outline"
												className="text-destructive hover:text-destructive"
											>
												Reject
											</Button>
										}
									/>
								</>
							)
						) : (
							<p className="text-sm text-muted-foreground">
								Only the authorised decider can act on this request.
							</p>
						)}

						{canWithdraw ? (
							<Button
								type="button"
								variant="ghost"
								className="ml-auto"
								onClick={() => setWithdrawOpen(true)}
							>
								Withdraw request
							</Button>
						) : null}
					</div>

					{approval.type === "REFUND" ? (
						<p className="text-sm text-muted-foreground">
							This refund has already been given. Your decision is recorded against it and changes
							no money.
						</p>
					) : null}
				</>
			) : null}

			<ConfirmDialog
				open={withdrawOpen}
				onOpenChange={setWithdrawOpen}
				title="Withdraw this request?"
				description="The request is marked withdrawn and no decider can act on it. You can raise a new request if it is still needed."
				confirmLabel="Withdraw"
				pending={withdraw.isPending}
				onConfirm={() => withdraw.mutate()}
			/>
		</div>
	)
}
