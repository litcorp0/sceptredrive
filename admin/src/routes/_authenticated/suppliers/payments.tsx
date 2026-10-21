import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/suppliers/payments")({
	component: SupplierPaymentsPlaceholder,
})

function SupplierPaymentsPlaceholder() {
	return (
		<p className="text-sm text-muted-foreground">
			Supplier payments land here in the payables plan.
		</p>
	)
}
