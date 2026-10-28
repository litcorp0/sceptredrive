import { createFileRoute } from "@tanstack/react-router"
import { ReconciliationPage, reconciliationSearchSchema } from "#/modules/payables"

export const Route = createFileRoute("/_authenticated/suppliers/reconciliation")({
	validateSearch: reconciliationSearchSchema,
	component: ReconciliationPage,
})
