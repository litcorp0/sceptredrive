import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { PosOversightPage, posSearchDefaults, posSearchSchema } from "#/modules/pos-oversight"

export const Route = createFileRoute("/_authenticated/pos/")({
	validateSearch: posSearchSchema,
	search: { middlewares: [stripSearchParams(posSearchDefaults)] },
	component: PosOversightPage,
})
