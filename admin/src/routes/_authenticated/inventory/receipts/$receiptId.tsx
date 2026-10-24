import { createFileRoute } from "@tanstack/react-router"
import { ReceiptDetailPage } from "#/modules/inventory"

export const Route = createFileRoute("/_authenticated/inventory/receipts/$receiptId")({
	component: ReceiptDetailPage,
})
