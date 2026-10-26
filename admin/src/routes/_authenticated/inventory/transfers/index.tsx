import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import {
	TransfersPage,
	transferSearchDefaults,
	transferSearchSchema,
} from "#/modules/inventory"

export const Route = createFileRoute("/_authenticated/inventory/transfers/")({
	validateSearch: transferSearchSchema,
	search: { middlewares: [stripSearchParams(transferSearchDefaults)] },
	component: TransfersPage,
})
