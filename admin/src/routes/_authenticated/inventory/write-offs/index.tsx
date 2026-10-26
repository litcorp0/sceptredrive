import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import { WriteOffsPage, writeOffSearchDefaults, writeOffSearchSchema } from "#/modules/inventory"

export const Route = createFileRoute("/_authenticated/inventory/write-offs/")({
	validateSearch: writeOffSearchSchema,
	search: { middlewares: [stripSearchParams(writeOffSearchDefaults)] },
	component: WriteOffsPage,
})
