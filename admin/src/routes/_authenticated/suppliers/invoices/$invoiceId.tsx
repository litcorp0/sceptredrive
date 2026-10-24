import { createFileRoute } from "@tanstack/react-router"
import { InvoiceDetailPage } from "#/modules/payables"

export const Route = createFileRoute("/_authenticated/suppliers/invoices/$invoiceId")({
	component: InvoiceDetailPage,
})
