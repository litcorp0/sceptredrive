import { createFileRoute } from "@tanstack/react-router"
import { InvoicesPage } from "#/modules/payables"

export const Route = createFileRoute("/_authenticated/suppliers/invoices/")({
	validateSearch: (search: Record<string, unknown>): { supplierId?: string } => ({
		supplierId: typeof search.supplierId === "string" ? search.supplierId : undefined,
	}),
	component: InvoicesPage,
})
