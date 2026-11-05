import { formatCount, type ReplenishmentBasis } from "@sceptre/shared"
import type { ReplenishmentRow } from "../types"

const BASIS_LABELS: Record<ReplenishmentBasis, string> = {
	COVERAGE: "Sales-cover target",
	STORED_MAX: "Stored maximum",
	STORED_MIN: "Reorder point",
	NO_HISTORY: "No sales history",
	NO_LEVEL: "No level set",
	AT_TARGET: "Already at target",
	MIN_ORDER: "Supplier minimum",
}

/** The machine value in words, for the basis line. */
export function formatBasis(basis: ReplenishmentBasis): string {
	return BASIS_LABELS[basis]
}

/**
 * One sentence explaining why the API suggested this quantity.
 *
 * It uses only fields the API returned. It is a summary, not a second calculation: the exact
 * arithmetic lives in `SuggestionBasis`.
 */
export function reasonSentence(row: ReplenishmentRow): string {
	switch (row.basis) {
		case "COVERAGE":
			return `Sales cover: ${formatCount(row.unitsSold)} sold in ${formatCount(row.velocityDays)} days and a ${formatCount(row.leadTimeDays)}-day lead time give a ${formatCount(row.coverageLevel)}-unit target.`
		case "STORED_MAX":
			return `Stored maximum: ${formatCount(row.maxLevel ?? 0)} units tops the ${formatCount(row.coverageLevel)}-unit sales cover.`
		case "STORED_MIN":
			return `Reorder point: the branch tops this part back up to ${formatCount(row.minLevel)} units (its own level, or the branch or company default).`
		case "NO_HISTORY":
			return `No sales in the last ${formatCount(row.velocityDays)} days, so the stored maximum is the only target.`
		case "NO_LEVEL":
			return "No maximum level is set and there are no sales to cover, so only the supplier minimum applies."
		case "AT_TARGET":
			return `On hand plus on order already reaches the ${formatCount(row.targetLevel)}-unit target.`
		case "MIN_ORDER":
			return `The supplier minimum of ${formatCount(row.minOrderQuantity)} units is more than the gap the target leaves.`
	}
}

/**
 * Tenths of a day as days, e.g. `72` -> `7.2 days`.
 *
 * This divides for display only; the API's average is already rounded to tenths and is not
 * recomputed from lines on screen.
 */
export function formatLeadDays(tenths: number | null): string {
	if (tenths === null || !Number.isSafeInteger(tenths)) return "—"
	const whole = Math.trunc(tenths / 10)
	const fraction = Math.abs(tenths % 10)
	return `${whole}.${fraction} days`
}
