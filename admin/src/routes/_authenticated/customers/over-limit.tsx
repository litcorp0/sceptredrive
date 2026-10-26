import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { OverLimitPage, overLimitSearchDefaults, overLimitSearchSchema } from "#/modules/credit"

export const Route = createFileRoute("/_authenticated/customers/over-limit")({
	validateSearch: overLimitSearchSchema,
	search: { middlewares: [stripSearchParams(overLimitSearchDefaults)] },
	component: OverLimitPage,
})
