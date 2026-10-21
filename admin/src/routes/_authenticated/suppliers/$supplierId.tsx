import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/suppliers/$supplierId")({
	component: SupplierDetailPlaceholder,
})

function SupplierDetailPlaceholder() {
	return <p className="text-sm text-muted-foreground">Supplier detail lands here.</p>
}
