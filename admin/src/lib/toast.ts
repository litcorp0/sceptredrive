import { toast } from "sonner"
import { ApiError } from "#/lib/api"

/**
 * Shows a failure toast with the API message and request ID so support can
 * trace it in the API logs. REAUTH_REQUIRED points the user at signing in again.
 */
export function toastApiError(
	error: unknown,
	fallback = "Something went wrong. Please try again.",
) {
	if (error instanceof ApiError) {
		if (error.code === "REAUTH_REQUIRED") {
			toast.error("For security, sign in again to continue.", {
				description: "Your session is older than an hour for this action.",
				action: {
					label: "Sign in",
					onClick: () => window.location.assign("/login"),
				},
			})
			return
		}
		toast.error(error.message, {
			description: error.requestId ? `Request ID: ${error.requestId}` : undefined,
		})
		return
	}
	toast.error(fallback)
}
