/**
 * Pure helpers behind the audit diff viewer. No React and no fetching, so they can be unit
 * tested without a DOM.
 */

export interface DiffRow {
	key: string
	/** `JSON.stringify` of the before value; `undefined` when the field was absent. */
	before: string | undefined
	after: string | undefined
	changed: boolean
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Every field in either snapshot, sorted, flagged when the serialized values differ. */
export function diffRows(
	before: Record<string, unknown>,
	after: Record<string, unknown>,
): DiffRow[] {
	const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()

	return keys.map((key) => {
		const beforeValue = JSON.stringify(before[key])
		const afterValue = JSON.stringify(after[key])
		return {
			key,
			before: beforeValue,
			after: afterValue,
			changed: beforeValue !== afterValue,
		}
	})
}
