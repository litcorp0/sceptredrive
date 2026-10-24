import { createFileRoute } from "@tanstack/react-router"
import { LoyaltyPage } from "#/modules/loyalty"

export const Route = createFileRoute("/_authenticated/loyalty")({
	component: LoyaltyPage,
})
