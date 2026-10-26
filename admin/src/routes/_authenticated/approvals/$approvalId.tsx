import { createFileRoute } from "@tanstack/react-router"
import { ApprovalDetailPage } from "#/modules/approvals"

export const Route = createFileRoute("/_authenticated/approvals/$approvalId")({
	component: ApprovalDetailPage,
})
