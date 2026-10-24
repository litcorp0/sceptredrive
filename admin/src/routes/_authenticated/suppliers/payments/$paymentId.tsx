import { createFileRoute } from "@tanstack/react-router"
import { PaymentDetailPage } from "#/modules/payables"

export const Route = createFileRoute("/_authenticated/suppliers/payments/$paymentId")({
	component: PaymentDetailPage,
})
