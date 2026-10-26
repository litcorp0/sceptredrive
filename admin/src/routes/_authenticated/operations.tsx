import { createFileRoute } from "@tanstack/react-router"
import { OperationsPage } from "#/modules/operations"

export const Route = createFileRoute("/_authenticated/operations")({
	component: OperationsPage,
})
