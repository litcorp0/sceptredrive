/**
 * Formats integer minor units (pesewas) as a GHS amount, e.g. 9500 -> "GHS 95.00".
 * Display only: stored and computed amounts always stay integer minor units.
 */
export function formatGhs(minorUnits: number): string {
	const whole = Math.trunc(minorUnits / 100)
	const fraction = Math.abs(minorUnits % 100)
	return `GHS ${whole.toLocaleString("en-GH")}.${String(fraction).padStart(2, "0")}`
}

/** Parses a GHS text amount ("95", "95.5", "95.50") into integer pesewas, or null. */
export function parseGhsToMinor(input: string): number | null {
	const trimmed = input.trim().replace(/,/g, "")
	if (trimmed.length === 0) return null
	if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return null
	const [whole = "0", fraction = ""] = trimmed.split(".")
	const pesewas = Number(whole) * 100 + Number(fraction.padEnd(2, "0"))
	return Number.isSafeInteger(pesewas) ? pesewas : null
}
