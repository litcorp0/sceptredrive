import { createFileRoute } from "@tanstack/react-router"
import { AuditPage } from "#/modules/audit"

export const Route = createFileRoute("/_authenticated/audit")({
	component: AuditPage,
})
