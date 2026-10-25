import { createFileRoute } from "@tanstack/react-router"
import { ProductSubmissionPage } from "#/modules/procurement"

export const Route = createFileRoute("/_authenticated/catalog/products/submit")({
	component: ProductSubmissionPage,
})
