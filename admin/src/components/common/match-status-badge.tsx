import type { LucideIcon } from "lucide-react"
import { CircleCheckIcon, CircleHelpIcon, TriangleAlertIcon } from "lucide-react"
import { StatusBadge, type StatusVariant } from "#/components/common/status-badge"
import type { InvoiceMatchStatus } from "#/modules/payables"

/**
 * A purchase invoice's match state, shared by the payables list and the invoice detail.
 *
 * It lives in `components/common` because payables renders it in two places and the shape is the
 * API's `invoice_match_status`. Every state is words first; the colour and icon are redundant
 * cues, never the message (WCAG 2.2 SC 1.4.1). A variance is advisory: a mismatched invoice still
 * posts to the supplier balance (P11-D5).
 */
const LABELS: Record<
	InvoiceMatchStatus,
	{ label: string; variant: StatusVariant; Icon: LucideIcon }
> = {
	MATCHED: { label: "Matched", variant: "ok", Icon: CircleCheckIcon },
	PRICE_VARIANCE: { label: "Price differs", variant: "warn", Icon: TriangleAlertIcon },
	QUANTITY_VARIANCE: { label: "Quantity differs", variant: "warn", Icon: TriangleAlertIcon },
	PRICE_AND_QUANTITY_VARIANCE: {
		label: "Price and quantity differ",
		variant: "warn",
		Icon: TriangleAlertIcon,
	},
	NOT_ON_ORDER: { label: "Not on order", variant: "danger", Icon: TriangleAlertIcon },
	UNMATCHED: { label: "Not matched", variant: "muted", Icon: CircleHelpIcon },
}

export function MatchStatusBadge({ status }: { status: InvoiceMatchStatus }) {
	const { label, variant, Icon } = LABELS[status]
	return (
		<StatusBadge variant={variant}>
			<Icon className="size-3" aria-hidden="true" />
			{label}
		</StatusBadge>
	)
}

/**
 * The list row's badge. The list carries `hasVariance` and the purchase-order id, not the
 * per-line status; "Variance to check" is the honest summary of a boolean, and the detail page
 * names which variance it is.
 */
export function InvoiceVarianceBadge({
	hasVariance,
	purchaseOrderId,
}: {
	hasVariance: boolean
	purchaseOrderId: string | null
}) {
	if (hasVariance) {
		return (
			<StatusBadge variant="warn">
				<TriangleAlertIcon className="size-3" aria-hidden="true" />
				Variance to check
			</StatusBadge>
		)
	}
	if (purchaseOrderId) {
		return (
			<StatusBadge variant="ok">
				<CircleCheckIcon className="size-3" aria-hidden="true" />
				Matched
			</StatusBadge>
		)
	}
	return (
		<StatusBadge variant="muted">
			<CircleHelpIcon className="size-3" aria-hidden="true" />
			Not matched
		</StatusBadge>
	)
}
