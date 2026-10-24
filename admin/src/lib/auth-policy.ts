import { createServerFn } from "@tanstack/react-start"
import { env } from "#/env"

export interface AuthPolicy {
	/** True when administrators must have TOTP before using the console. */
	requireTwoFactor: boolean
}

/**
 * Reads the public authentication policy from the API.
 *
 * Guard decisions (forced TOTP setup) depend on this. A network failure returns
 * "not required" rather than locking an operator out of the console: the API is
 * unreachable anyway, so the console cannot do anything useful until it returns.
 */
export const getAuthPolicy = createServerFn({ method: "GET" }).handler(
	async (): Promise<AuthPolicy> => {
		try {
			const response = await fetch(`${env.VITE_API_URL}/api/auth/policy`, {
				headers: { accept: "application/json" },
			})
			if (!response.ok) return { requireTwoFactor: false }
			const data = (await response.json()) as { requireTwoFactor?: unknown }
			return { requireTwoFactor: data?.requireTwoFactor === true }
		} catch {
			return { requireTwoFactor: false }
		}
	},
)
