import { createFileRoute, stripSearchParams } from "@tanstack/react-router"
import {
	ApprovalsPage,
	approvalSearchDefaults,
	approvalSearchSchema,
} from "#/modules/approvals"

export const Route = createFileRoute("/_authenticated/approvals/")({
	validateSearch: approvalSearchSchema,
	search: { middlewares: [stripSearchParams(approvalSearchDefaults)] },
	component: ApprovalsPage,
})
