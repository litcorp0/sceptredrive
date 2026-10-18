import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/branches")({
	component: BranchesPage,
})

function BranchesPage() {
	return (
		<div>
			<h1 className="text-xl font-semibold tracking-tight">Branches</h1>
			<p className="mt-1 text-sm text-muted-foreground">Manage branches and warehouses.</p>
		</div>
	)
}
