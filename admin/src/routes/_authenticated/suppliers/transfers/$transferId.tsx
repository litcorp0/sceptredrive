import { createFileRoute } from "@tanstack/react-router"
import { TransferDetailPage } from "#/modules/payables"

export const Route = createFileRoute("/_authenticated/suppliers/transfers/$transferId")({
	component: TransferDetailPage,
})
