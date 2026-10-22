import { createFileRoute } from "@tanstack/react-router"
import { InvoiceForm } from "#/components/payables/invoice-form"

export const Route = createFileRoute("/_authenticated/suppliers/invoices/new")({
	validateSearch: (
		search: Record<string, unknown>,
	): { receiptId?: string; supplierId?: string } => ({
		receiptId: typeof search.receiptId === "string" ? search.receiptId : undefined,
		supplierId: typeof search.supplierId === "string" ? search.supplierId : undefined,
	}),
	component: NewInvoicePage,
})

function NewInvoicePage() {
	const { receiptId, supplierId } = Route.useSearch()
	return <InvoiceForm receiptId={receiptId} supplierId={supplierId} />
}
