import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/settings")({
	component: SettingsPage,
})

function SettingsPage() {
	return (
		<div>
			<h1 className="text-xl font-semibold tracking-tight">Settings</h1>
			<p className="mt-1 text-sm text-muted-foreground">
				Staff IDs, receipts, and loyalty configuration.
			</p>
		</div>
	)
}
