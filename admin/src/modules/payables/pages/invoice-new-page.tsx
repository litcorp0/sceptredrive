import { getRouteApi } from "@tanstack/react-router"
import { InvoiceForm } from "../components/invoice-form"

const invoiceNewRoute = getRouteApi("/_authenticated/suppliers/invoices/new")

/**
 * The new-invoice screen: standalone or copied from a goods receipt. The route keeps
 * `validateSearch` for `?receiptId=` / `?supplierId=`; this page reads them and hands them to the
 * form, which is where the preselection happens.
 */
export function InvoiceNewPage() {
	const { receiptId, supplierId } = invoiceNewRoute.useSearch()
	return <InvoiceForm receiptId={receiptId} supplierId={supplierId} />
}
