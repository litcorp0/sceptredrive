import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/customers/aging")({
	component: AgingTab,
})

function AgingTab() {
	return <p className="text-sm text-muted-foreground">The aging report is coming soon.</p>
}
