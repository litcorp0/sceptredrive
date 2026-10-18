import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/terminals")({
	component: TerminalsPage,
})

function TerminalsPage() {
	return (
		<div>
			<h1 className="text-xl font-semibold tracking-tight">Terminals</h1>
			<p className="mt-1 text-sm text-muted-foreground">
				Manage POS terminals and enrollment codes.
			</p>
		</div>
	)
}
