import type { ApprovalReasonCode, ApprovalType } from "@sceptre/shared"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { toast } from "sonner"
import { Button } from "#/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "#/components/ui/dialog"
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
import { toastApiError } from "#/lib/toast"
import { decideApproval } from "../api/approvals"
import { approvalKeys } from "../api/keys"
import { APPROVAL_REASON_LABELS, APPROVAL_REASON_OPTIONS, typeLabel } from "../utils/approval"

const INLINE_ERROR_STATUSES = new Set([400, 403, 409])

interface DecisionDialogProps {
	approvalId: string
	type: ApprovalType
	/** Fixed by the button that opened the dialog; a variance review only records an outcome. */
	decision: "APPROVED" | "REJECTED"
	/** The button that opens the dialog. Radix returns focus to it when the dialog closes. */
	trigger: ReactNode
}

/**
 * The one place a decision is submitted.
 *
 * The server is authoritative on every rule the dialog hints at: a rejection without a reason
 * code is refused, and a variance review accepts `APPROVED` only and needs a note. Those rules
 * are enforced again by the API; this dialog asks first so a manager sees why before submitting.
 *
 * Radix owns focus: opening moves focus into the dialog, closing returns it to the button that
 * opened it, and Escape closes without submitting.
 */
export function DecisionDialog({ approvalId, type, decision, trigger }: DecisionDialogProps) {
	const [open, setOpen] = useState(false)
	const queryClient = useQueryClient()
	const variance = type === "SHIFT_VARIANCE_REVIEW"
	const rejecting = decision === "REJECTED"

	const [reasonCode, setReasonCode] = useState<ApprovalReasonCode | "">("")
	const [note, setNote] = useState("")
	const [formError, setFormError] = useState<string | null>(null)

	const mutation = useMutation({
		mutationFn: () =>
			decideApproval(approvalId, {
				decision,
				...(rejecting && reasonCode ? { reasonCode } : {}),
				...(note.trim() ? { note: note.trim() } : {}),
			}),
		onSuccess: async () => {
			toast.success(
				variance ? "Outcome recorded" : decision === "APPROVED" ? "Approved" : "Rejected",
			)
			await queryClient.invalidateQueries({ queryKey: approvalKeys.all })
			setOpen(false)
		},
		onError: (error) => {
			if (error instanceof ApiError && INLINE_ERROR_STATUSES.has(error.status)) {
				setFormError(error.message)
				return
			}
			toastApiError(error)
		},
	})

	function close(next: boolean) {
		if (!next) {
			setReasonCode("")
			setNote("")
			setFormError(null)
		}
		setOpen(next)
	}

	function submit() {
		setFormError(null)
		if (variance && note.trim().length < 3) {
			setFormError("Record what you found before closing the review.")
			return
		}
		if (rejecting && !reasonCode) {
			setFormError("Choose a reason code before rejecting.")
			return
		}
		mutation.mutate()
	}

	return (
		<Dialog open={open} onOpenChange={close}>
			<DialogTrigger asChild>{trigger}</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>
						{variance ? "Record outcome" : rejecting ? "Reject request" : "Approve request"}
					</DialogTitle>
					<DialogDescription>
						{variance
							? "A variance review records what you found; it cannot be rejected. Your name and note are written to the audit trail."
							: rejecting
								? `Rejecting a ${typeLabel(type).toLowerCase()} needs a reason code. The requester sees it.`
								: `Approving a ${typeLabel(type).toLowerCase()} is recorded against your name in the audit trail.`}
					</DialogDescription>
				</DialogHeader>

				<div className="grid gap-4">
					{rejecting ? (
						<div className="grid gap-1.5">
							<Label htmlFor="decision-reason">Reason code</Label>
							<Select
								value={reasonCode || undefined}
								onValueChange={(value) => setReasonCode(value as ApprovalReasonCode)}
							>
								<SelectTrigger id="decision-reason" className="w-full">
									<SelectValue placeholder="Choose a reason" />
								</SelectTrigger>
								<SelectContent>
									{APPROVAL_REASON_OPTIONS.map((code) => (
										<SelectItem key={code} value={code}>
											{APPROVAL_REASON_LABELS[code]}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					) : null}

					<div className="grid gap-1.5">
						<Label htmlFor="decision-note">
							{variance ? "What you found" : "Note"}
							{variance ? "" : " (optional)"}
						</Label>
						<Textarea
							id="decision-note"
							rows={3}
							maxLength={300}
							value={note}
							onChange={(event) => setNote(event.target.value)}
							aria-describedby={variance ? "decision-note-hint" : undefined}
						/>
						{variance ? (
							<p id="decision-note-hint" className="text-xs text-muted-foreground">
								At least three characters. This becomes the shift's review note.
							</p>
						) : null}
					</div>

					{formError ? (
						<p role="alert" className="text-sm text-destructive">
							{formError}
						</p>
					) : null}
				</div>

				<DialogFooter>
					<Button
						type="button"
						variant="outline"
						onClick={() => close(false)}
						disabled={mutation.isPending}
					>
						Cancel
					</Button>
					<Button
						type="button"
						variant={rejecting ? "destructive" : "default"}
						onClick={submit}
						disabled={mutation.isPending}
					>
						{mutation.isPending
							? "Saving…"
							: variance
								? "Record outcome"
								: rejecting
									? "Reject"
									: "Approve"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
