import { createFileRoute } from "@tanstack/react-router"

export const Route = createFileRoute("/_authenticated/inventory/receipts/$receiptId")({
	component: ReceiptDetailPlaceholder,
})

function ReceiptDetailPlaceholder() {
	return (
		<p className="text-sm text-muted-foreground">
			Receipt detail lands here in the receipt-linking task.
		</p>
	)
}
