import { Link } from "@tanstack/react-router"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { formatGhs } from "#/lib/format"
import type { ApprovalSubject } from "../../types"

type PurchaseOrderSubjectArm = Extract<ApprovalSubject, { kind: "purchase_order" }>

/**
 * A purchase order over the threshold.
 *
 * The subject arm carries the order's id only; the order, its supplier and its lines belong to
 * the procurement module. The inbox shows the value the decision is about and sends the decider
 * to the document, rather than re-fetching another module's screen through a barrel cycle.
 */
export function PurchaseOrderSubject({
	subject,
	amountMinor,
}: {
	subject: PurchaseOrderSubjectArm
	amountMinor: number | null
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>Purchase order over the approval threshold</CardTitle>
				<CardDescription>
					Approving releases the order to its supplier. Rejecting returns it to the requester.
				</CardDescription>
			</CardHeader>
			<CardContent className="grid gap-3 text-sm">
				<div className="flex flex-wrap justify-between gap-2">
					<span className="text-muted-foreground">Goods value (ex-tax)</span>
					<span className="font-medium tabular-nums">
						{amountMinor === null ? "—" : formatGhs(amountMinor)}
					</span>
				</div>
				<Link
					to="/procurement/orders/$orderId"
					params={{ orderId: subject.purchaseOrderId }}
					className="w-fit text-sm font-medium text-primary hover:underline"
				>
					Open the purchase order
				</Link>
			</CardContent>
		</Card>
	)
}
