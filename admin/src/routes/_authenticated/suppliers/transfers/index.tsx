import { createFileRoute } from "@tanstack/react-router"
import { TransfersPage, transferSearchSchema } from "#/modules/payables"

export const Route = createFileRoute("/_authenticated/suppliers/transfers/")({
	validateSearch: transferSearchSchema,
	component: TransfersPage,
})
