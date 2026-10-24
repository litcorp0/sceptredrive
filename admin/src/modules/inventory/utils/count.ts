/**
 * A blank box counts as "not counted yet" (`null`); anything that is not a whole, non-negative
 * number is `"invalid"` and must block the save rather than be silently dropped.
 */
export function parseCounted(raw: string | undefined): number | null | "invalid" {
	if (raw === undefined || raw.trim() === "") return null
	const value = Number.parseInt(raw, 10)
	if (!Number.isSafeInteger(value) || value < 0) return "invalid"
	return value
}
