import type { SiteBranch } from "@sceptre/shared"

/**
 * Phone and link builders. Every helper returns `null` for an empty value, so a
 * page can hide an action the operator has not configured instead of rendering
 * a dead `tel:` with no number.
 */

export function telHref(phone: string): string | null {
	const value = phone.replace(/[^\d+]/g, "")
	return value.replace(/\D/g, "").length >= 7 ? `tel:${value}` : null
}

export function waHref(phone: string, message: string): string | null {
	const digits = phone.replace(/\D/g, "")
	if (digits.length < 7) return null
	return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

export function mailHref(email: string, subject?: string): string | null {
	const value = email.trim()
	if (!value) return null
	return `mailto:${value}${subject ? `?subject=${encodeURIComponent(subject)}` : ""}`
}

export function mapsHref(branch: SiteBranch): string | null {
	if (branch.mapUrl) return branch.mapUrl
	const query = [branch.address, branch.area, branch.city].filter(Boolean).join(", ")
	return query
		? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
		: null
}

export function partMessage(part: string): string {
	const trimmed = part.trim()
	return trimmed
		? `Hello Sceptre Drive, I'm looking for ${trimmed}.`
		: "Hello Sceptre Drive, I'd like help finding a part."
}
