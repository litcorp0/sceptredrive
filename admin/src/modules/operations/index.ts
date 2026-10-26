/**
 * `operations` — the manager's branch view.
 *
 * One read (`GET /api/operations/summary`) returns six queue counts and the count-accuracy figure,
 * each already branch-scoped by the API. A section the caller may not see is absent from the
 * response and is not rendered; the console never turns absence into a zero card.
 */
export { operationsSummaryOptions } from "./api/operations"
export { operationsKeys } from "./api/keys"
export { QueueCard } from "./components/queue-card"
export { OperationsPage } from "./pages/operations-page"
export type {
	OperationsApprovalQueue,
	OperationsQueue,
	OperationsSummary,
} from "./types"
export { type QueueKind, type QueueLink, queueLink } from "./utils/queue"
