import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/audit")({
	component: AuditPage,
})

function AuditPage() {
	return (
		<div>
			<h1 className="text-xl font-semibold tracking-tight">Audit log</h1>
			<p className="mt-1 text-sm text-muted-foreground">
				Every change made in the console, in order.
			</p>
		</div>
	)
}
