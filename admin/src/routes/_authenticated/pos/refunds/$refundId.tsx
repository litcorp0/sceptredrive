import { createFileRoute } from "@tanstack/react-router"
import { RefundDetailPage } from "#/modules/pos-oversight"

export const Route = createFileRoute("/_authenticated/pos/refunds/$refundId")({
	component: RefundDetailPage,
})
