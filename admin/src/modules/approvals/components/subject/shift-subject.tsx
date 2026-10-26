import { formatCount, formatDateTime } from "@sceptre/shared"
import { StatusBadge } from "#/components/common/status-badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { formatGhs } from "#/lib/format"
import type { ApprovalSubject } from "../../types"
import { signedAmountText } from "../../utils/approval"

type ShiftSubjectArm = Extract<ApprovalSubject, { kind: "shift_variance" }>

/**
 * A closed shift whose cash variance needs a manager's review.
 *
 * The reviewer sees the drawer's arithmetic: what the server expected, what the cashier counted,
 * and what the terminal itself expected at close. A terminal and a server that disagreed reads
 * differently from a wrong drawer (P12-D24), so the mismatch is named rather than averaged away.
 */
export function ShiftSubject({ subject }: { subject: ShiftSubjectArm }) {
	const mismatch = subject.clientExpectedMinor !== subject.expectedMinor

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex flex-wrap items-center gap-2">
					Shift {subject.shiftNumber}
					<StatusBadge variant="warn">Awaiting review</StatusBadge>
					{mismatch ? <StatusBadge variant="danger">Terminal disagreed</StatusBadge> : null}
				</CardTitle>
				<CardDescription>
					{subject.terminalName} · {subject.cashierName ?? "Unknown cashier"} ·{" "}
					{formatDateTime(subject.openedAt)} → {formatDateTime(subject.closedAt)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<dl className="grid gap-2 text-sm">
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Expected by the server</dt>
						<dd className="tabular-nums">{formatGhs(subject.expectedMinor)}</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Counted by the cashier</dt>
						<dd className="tabular-nums">{formatGhs(subject.countedMinor)}</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Variance</dt>
						<dd className="font-medium tabular-nums">{signedAmountText(subject.varianceMinor)}</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Expected by the terminal at close</dt>
						<dd className="tabular-nums">{formatGhs(subject.clientExpectedMinor)}</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Sales in the shift</dt>
						<dd className="tabular-nums">{formatCount(subject.saleCount)}</dd>
					</div>
				</dl>
				<p className="mt-3 text-xs text-muted-foreground">
					{mismatch
						? "The terminal and the server disagreed about expected cash. Record what you found before closing the review."
						: "The terminal and the server agreed on expected cash. Record what you found before closing the review."}
				</p>
			</CardContent>
		</Card>
	)
}
