import { formatCount } from "@sceptre/shared"
import { formatGhs } from "#/lib/format"

/**
 * Recharts hands a tooltip formatter `ValueType | undefined`, which is wider than a number.
 * These two wrappers keep the display rules in one place: the tooltip shows exact money, and
 * an axis tick shows rounded cedis (the data table carries the exact figure).
 */
export function moneyTooltip(value: unknown): string {
	const numeric = typeof value === "number" ? value : Number(value ?? 0)
	return formatGhs(Number.isFinite(numeric) ? numeric : 0)
}

export function cedisTick(value: number): string {
	return formatCount(Math.round(value / 100))
}

export function pointsTooltip(value: unknown): string {
	const numeric = typeof value === "number" ? value : Number(value ?? 0)
	return formatCount(Number.isFinite(numeric) ? numeric : 0)
}
