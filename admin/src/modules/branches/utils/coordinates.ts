/**
 * Parses a latitude/longitude input.
 *
 * Empty means "not set" — a branch may be created before anyone walks outside with a phone.
 * A non-number or an out-of-range value is refused here rather than sent to the API: it would
 * be rejected anyway, and a form that quietly drops the value is how a branch ends up with no
 * pin on the map at all.
 */
export function parseCoordinate(
	raw: string,
	bounds: { min: number; max: number },
	label: string,
): number | undefined {
	const value = raw.trim()
	if (!value) return undefined

	const parsed = Number(value)
	if (!Number.isFinite(parsed) || parsed < bounds.min || parsed > bounds.max) {
		throw new Error(`${label} must be a number between ${bounds.min} and ${bounds.max}`)
	}
	return parsed
}

export const LATITUDE_BOUNDS = { min: -90, max: 90 } as const
export const LONGITUDE_BOUNDS = { min: -180, max: 180 } as const
