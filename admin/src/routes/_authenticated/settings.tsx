import { createFileRoute } from "@tanstack/react-router"
import { SettingsPage } from "#/modules/settings"

export const Route = createFileRoute("/_authenticated/settings")({
	component: SettingsPage,
})
