import { formatTime } from "@sceptre/shared"
import type { EvatHealth } from "../types"

/**
 * One quiet line, not a banner. The provider being reachable is the ordinary case and does not
 * deserve attention; an unreachable one does. The detail is the provider's own message with no
 * credential in it.
 */
export function EvatHealthLine({
	health,
	isLoading,
	isError,
}: {
	health: EvatHealth | undefined
	isLoading: boolean
	isError: boolean
}) {
	if (isLoading) {
		return <p className="text-xs text-muted-foreground">Checking the E-VAT provider…</p>
	}

	if (isError || !health) {
		return (
			<output className="block text-xs text-destructive">
				The E-VAT provider health could not be read.
			</output>
		)
	}

	if (!health.ok) {
		return (
			<output className="block text-xs text-destructive">
				The E-VAT provider is unavailable
				{health.detail ? ` — ${health.detail}` : "."}
			</output>
		)
	}

	return (
		<p className="text-xs text-muted-foreground" data-slot="evat-health">
			Provider reachable · checked {formatTime(health.checkedAt)}
			{health.cached ? " (cached)" : ""}
		</p>
	)
}
