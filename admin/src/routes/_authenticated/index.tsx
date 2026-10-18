import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/")({
	component: DashboardPlaceholder,
})

function DashboardPlaceholder() {
	const { session } = Route.useRouteContext()

	return (
		<div className="p-6">
			<h1 className="text-xl font-semibold tracking-tight">Welcome, {session.user.name}</h1>
			<p className="mt-1 text-sm text-muted-foreground">
				Signed in as {session.user.email}
				{session.user.staffId ? ` · ${session.user.staffId}` : ""}
				{session.user.role ? ` · ${session.user.role}` : ""}
			</p>
		</div>
	)
}
