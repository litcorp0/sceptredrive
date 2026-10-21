import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/suppliers/aging")({
	component: SupplierAgingPlaceholder,
})

function SupplierAgingPlaceholder() {
	return (
		<p className="text-sm text-muted-foreground">Payables aging lands here in the payables plan.</p>
	)
}
