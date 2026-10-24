import { createFileRoute } from "@tanstack/react-router"
import { CreditStatementPage } from "#/modules/credit"

export const Route = createFileRoute("/_authenticated/customers/$id/statement")({
	component: CreditStatementPage,
})
