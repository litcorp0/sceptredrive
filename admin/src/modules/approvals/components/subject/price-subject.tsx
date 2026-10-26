import { StatusBadge } from "#/components/common/status-badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { formatGhs } from "#/lib/format"
import type { ApprovalSubject } from "../../types"
import { bandLabel } from "../../utils/approval"

type PriceSubjectArm = Extract<ApprovalSubject, { kind: "price_change" }>

/**
 * A price outside the allowed band, with the band the request was judged against.
 *
 * `bounds` and `bandPercent` are the stored values from the request, not today's setting: widening
 * the band tomorrow must not rewrite the reason today's request exists (P12-D19).
 */
export function PriceSubject({ subject }: { subject: PriceSubjectArm }) {
	const inside =
		subject.proposedPriceMinor >= subject.bounds.minMinor &&
		subject.proposedPriceMinor <= subject.bounds.maxMinor

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex flex-wrap items-center gap-2">
					{subject.productName}
					<StatusBadge variant={inside ? "ok" : "warn"}>
						{inside ? "Inside the band" : "Outside the band"}
					</StatusBadge>
				</CardTitle>
				<CardDescription className="font-mono text-xs">{subject.sku}</CardDescription>
			</CardHeader>
			<CardContent>
				<dl className="grid gap-2 text-sm">
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Current price</dt>
						<dd className="tabular-nums">{formatGhs(subject.currentPriceMinor)}</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Proposed price</dt>
						<dd className="font-medium tabular-nums">{formatGhs(subject.proposedPriceMinor)}</dd>
					</div>
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Allowed band</dt>
						<dd className="tabular-nums">
							±{bandLabel(subject.bandPercent)} ({formatGhs(subject.bounds.minMinor)} –{" "}
							{formatGhs(subject.bounds.maxMinor)})
						</dd>
					</div>
				</dl>
			</CardContent>
		</Card>
	)
}
