import { useMutation } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { CopyButton } from "#/components/common/copy-button"
import { Button } from "#/components/ui/button"
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "#/components/ui/dialog"
import { toastApiError } from "#/lib/toast"
import { createEnrollment } from "../api/terminals"
import type { Enrollment, Terminal } from "../types"

/**
 * The one-time enrollment code surface. The code is a credential: it lives in local state only,
 * never in a query key, and is never logged. Each generate call expires the previous code.
 *
 * It is also emailed to the branch's managers (P20-D5), so it stays on screen as well: a mail
 * server that is down must cost a message, not a terminal. The dialog says which happened.
 */
export function EnrollmentDialog({
	terminal,
	onClose,
}: {
	terminal: Terminal
	onClose: () => void
}) {
	const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
	const [now, setNow] = useState(() => Date.now())

	useEffect(() => {
		if (!enrollment) return
		const timer = setInterval(() => setNow(Date.now()), 1000)
		return () => clearInterval(timer)
	}, [enrollment])

	const createMutation = useMutation({
		mutationFn: () => createEnrollment(terminal.id),
		onSuccess: (data) => {
			setEnrollment(data.enrollment)
			setNow(Date.now())
		},
		onError: (error) => toastApiError(error),
	})

	const remainingMs = enrollment ? new Date(enrollment.expiresAt).getTime() - now : 0
	const hours = Math.max(0, Math.floor(remainingMs / 3_600_000))
	const minutes = Math.max(0, Math.floor((remainingMs % 3_600_000) / 60_000))
	const expired = enrollment !== null && remainingMs <= 0

	return (
		<Dialog open onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Enrollment code</DialogTitle>
					<DialogDescription>
						{terminal.code} · {terminal.name}
					</DialogDescription>
				</DialogHeader>

				{enrollment ? (
					<div className="grid gap-4">
						<div className="rounded-lg border bg-muted/40 p-4 text-center">
							<p className="font-mono text-2xl font-semibold tracking-[0.2em]">{enrollment.code}</p>
							<p className="mt-2 text-xs text-muted-foreground">
								{expired
									? "Expired — generate a new code."
									: `Expires in ${hours}h ${String(minutes).padStart(2, "0")}m`}
							</p>
						</div>
						<CopyButton value={enrollment.code} label="Copy code" />
						{enrollment.emailedTo.length > 0 ? (
							<p className="text-xs text-muted-foreground">
								Emailed to {enrollment.emailedTo.length}{" "}
								{enrollment.emailedTo.length === 1 ? "manager" : "managers"} at this branch:{" "}
								{enrollment.emailedTo.join(", ")}.
							</p>
						) : null}
						{enrollment.emailFailed.length > 0 ? (
							<p className="text-xs text-destructive">
								Could not email {enrollment.emailFailed.join(", ")}. Give the code to them directly.
							</p>
						) : null}
						{enrollment.noRecipients ? (
							<p className="text-xs text-muted-foreground">
								This branch has no manager to email, so hand the code over in person.
							</p>
						) : null}
						<p className="text-xs text-muted-foreground">
							Enter this code in the POS app to enroll this terminal. Generating a new code expires
							the previous one; each code works once.
						</p>
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						Generate a one-time code, then enter it in the POS app on this terminal. The code
						expires after 24 hours and is emailed to this branch's managers.
					</p>
				)}

				<DialogFooter>
					<Button type="button" variant="outline" onClick={onClose}>
						Close
					</Button>
					<Button
						type="button"
						disabled={createMutation.isPending}
						onClick={() => createMutation.mutate()}
					>
						{createMutation.isPending
							? "Generating…"
							: enrollment
								? "Generate new code"
								: "Generate code"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
