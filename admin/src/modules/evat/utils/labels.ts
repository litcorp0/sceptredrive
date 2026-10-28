import { type EvatSubmissionStatus, formatCount } from "@sceptre/shared"
import type { StatusVariant } from "#/components/common/status-badge"

/**
 * A submission is never colour-coded alone: the badge carries its label too. `ATTENTION` is the
 * only failure state; `RETRY` is a ladder that is working, and `WAITING_FOR_INVOICE` is waiting
 * on its own sale rather than on GRA.
 */
export function evatStatusVariant(status: EvatSubmissionStatus): StatusVariant {
	switch (status) {
		case "CERTIFIED":
			return "ok"
		case "ATTENTION":
			return "danger"
		case "RETRY":
			return "warn"
		case "SUBMITTING":
		case "QUEUED":
			return "info"
		case "WAITING_FOR_INVOICE":
			return "muted"
	}
}

/**
 * "6 h 20 m" for the oldest overdue document. Hours and minutes are separate counts, not a
 * decimal: an operator reads a deadline, not a fraction.
 */
export function formatDurationMinutes(minutes: number): string {
	const total = Math.max(0, Math.trunc(minutes))
	const hours = Math.floor(total / 60)
	const remainder = total % 60
	if (hours === 0) return `${formatCount(remainder)} m`
	if (remainder === 0) return `${formatCount(hours)} h`
	return `${formatCount(hours)} h ${formatCount(remainder)} m`
}

/**
 * GRA's signature is one string; four groups are how a person reads it back over a phone.
 * Whitespace inside the value is presentation, never data, so it is removed before grouping.
 */
export function groupSignature(signature: string): string[] {
	const clean = signature.replace(/\s+/g, "")
	if (clean === "") return []
	const size = Math.ceil(clean.length / 4)
	const groups: string[] = []
	for (let index = 0; index < 4; index += 1) {
		const group = clean.slice(index * size, (index + 1) * size)
		if (group.length > 0) groups.push(group)
	}
	return groups
}
