import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/suppliers/invoices")({
	component: SupplierInvoicesPlaceholder,
})

function SupplierInvoicesPlaceholder() {
	return (
		<p className="text-sm text-muted-foreground">
			Purchase invoices land here in the payables plan.
		</p>
	)
}
