import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/staff")({
	component: StaffPage,
})

function StaffPage() {
	return (
		<div>
			<h1 className="text-xl font-semibold tracking-tight">Staff</h1>
			<p className="mt-1 text-sm text-muted-foreground">Manage manager and cashier accounts.</p>
		</div>
	)
}
