import { createFileRoute } from "@tanstack/react-router"
import { CategoriesPage } from "#/modules/catalog"

export const Route = createFileRoute("/_authenticated/catalog/categories")({
	component: CategoriesPage,
})
