import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { formatGhs } from "#/lib/format"
import type { ApprovalSubject } from "../../types"
import { proposalMinor, proposalName, proposalText } from "../../utils/approval"

type ProductSubjectArm = Extract<ApprovalSubject, { kind: "product" }>

/**
 * A `PRODUCT_CREATE` proposal, as the manager submitted it. The proposal has no product row yet,
 * so this is the whole document; approving it is what creates the catalogue entry.
 */
export function ProductSubject({ subject }: { subject: ProductSubjectArm }) {
	const description = proposalText(subject.proposal, "description")
	const barcode = proposalText(subject.proposal, "barcode")
	const priceMinor =
		proposalMinor(subject.proposal, "proposedBasePriceMinor") ??
		proposalMinor(subject.proposal, "proposedPriceMinor")
	const openingQuantity = proposalMinor(subject.proposal, "openingQuantity")
	const openingCostMinor = proposalMinor(subject.proposal, "openingUnitCostMinor")

	return (
		<Card>
			<CardHeader>
				<CardTitle>{proposalName(subject.proposal)}</CardTitle>
				<CardDescription>Proposed catalogue entry</CardDescription>
			</CardHeader>
			<CardContent>
				<dl className="grid gap-2 text-sm">
					<div className="flex flex-wrap justify-between gap-2">
						<dt className="text-muted-foreground">Proposed selling price</dt>
						<dd className="font-medium tabular-nums">
							{priceMinor === null ? "—" : formatGhs(priceMinor)}
						</dd>
					</div>
					{barcode ? (
						<div className="flex flex-wrap justify-between gap-2">
							<dt className="text-muted-foreground">Barcode</dt>
							<dd className="font-mono text-xs">{barcode}</dd>
						</div>
					) : null}
					{description ? (
						<div className="flex flex-wrap justify-between gap-2">
							<dt className="text-muted-foreground">Description</dt>
							<dd className="max-w-96 text-right">{description}</dd>
						</div>
					) : null}
					{openingQuantity !== null && openingCostMinor !== null ? (
						<div className="flex flex-wrap justify-between gap-2">
							<dt className="text-muted-foreground">Opening stock</dt>
							<dd className="text-right tabular-nums">
								{openingQuantity} × {formatGhs(openingCostMinor)} ={" "}
								{formatGhs(openingQuantity * openingCostMinor)}
							</dd>
						</div>
					) : null}
				</dl>
			</CardContent>
		</Card>
	)
}
