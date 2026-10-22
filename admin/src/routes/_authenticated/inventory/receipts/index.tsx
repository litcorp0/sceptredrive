import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/inventory/receipts/")({
	component: ReceiptsPlaceholder,
})

function ReceiptsPlaceholder() {
	return (
		<p className="text-sm text-muted-foreground">
			Goods receipts land here in the receipt-linking task.
		</p>
	)
}
