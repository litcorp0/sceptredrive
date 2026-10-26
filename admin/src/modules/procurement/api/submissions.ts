import { apiRequest } from "#/lib/api"
import type { ProductSubmissionInput, ProductSubmissionResult } from "../types"

/**
 * `POST /api/products/submissions` — the manager's half of a `PRODUCT_CREATE` decision.
 *
 * The body is a proposal, not a product: the API inserts nothing and answers with the approval it
 * queued. An admin is refused here on purpose (the product screen is theirs), and the server
 * enforces that rather than this form.
 */
export function submitProductProposal(input: ProductSubmissionInput) {
	return apiRequest<ProductSubmissionResult>("/api/products/submissions", {
		method: "POST",
		body: input,
	})
}
