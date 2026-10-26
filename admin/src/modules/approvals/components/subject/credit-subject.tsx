import { formatBasisPoints } from "@sceptre/shared"
import { Link } from "@tanstack/react-router"
import { StatusBadge } from "#/components/common/status-badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { formatGhs } from "#/lib/format"
import type { ApprovalSubject } from "../../types"

type CreditSubjectArm = Extract<ApprovalSubject, { kind: "credit_limit_change" }>

/**
 * A credit limit change, with where the customer stands if it is approved.
 *
 * The position is computed by the API (`resultingPosition`), never here: an approval that still
 * leaves the customer over the limit is allowed and must be visible before the decision.
 */
export function CreditSubject({ subject }: { subject: CreditSubjectArm }) {
	const position = subject.resultingPosition

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex flex-wrap items-center gap-2">
					{subject.customerName}
					{position.overLimit ? (
						<StatusBadge variant="warn">Still over the limit</StatusBadge>
					) : null}
				</CardTitle>
				<CardDescription>
					{subject.phone ?? "No phone on file"} ·{" "}
					<Link
						to="/customers/$id"
						params={{ id: subject.customerId }}
						className="font-medium text-primary hover:underline"
					>
						Open the customer profile
					</Link>
				</CardDescription>
			</CardHeader>
			<CardContent>
				<dl className="grid gap-2 text-sm">
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Current limit</dt>
						<dd className="tabular-nums">{formatGhs(subject.currentLimitMinor)}</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Proposed limit</dt>
						<dd className="font-medium tabular-nums">{formatGhs(subject.proposedLimitMinor)}</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Balance now</dt>
						<dd className="tabular-nums">{formatGhs(subject.balanceMinor)}</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Utilisation after approval</dt>
						<dd className="tabular-nums">{formatBasisPoints(subject.utilisationBp)}</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">
							{position.overLimit ? "Over the limit by" : "Headroom after approval"}
						</dt>
						<dd className="font-medium tabular-nums">
							{position.overLimit
								? formatGhs(position.overByMinor)
								: formatGhs(position.headroomMinor)}
						</dd>
					</div>
					{position.blocksNewCredit ? (
						<div className="flex flex-wrap justify-between gap-2">
							<dt className="text-muted-foreground">Next credit sale</dt>
							<dd className="text-right">It would exceed the proposed limit</dd>
						</div>
					) : null}
				</dl>
			</CardContent>
		</Card>
	)
}
