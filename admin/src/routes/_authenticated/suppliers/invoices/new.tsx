import { createFileRoute } from "@tanstack/react-router"
// TODO(phase-8/11): payables component — this screen is payables'; Plan 11 moves it into
// `modules/payables` and flips these imports to `#/modules/payables`.
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
