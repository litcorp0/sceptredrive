import { z } from "zod"
import type { StockMovementType } from "../types"

/** How each ledger movement reads in the history table. */
export const MOVEMENT_META: Record<
	StockMovementType,
	{ label: string; tone: "green" | "zinc" | "amber" | "red" | "blue" }
> = {
	RECEIPT: { label: "Receipt", tone: "green" },
	ADJUSTMENT: { label: "Adjustment", tone: "amber" },
	TRANSFER_OUT: { label: "Transfer out", tone: "blue" },
	TRANSFER_IN: { label: "Transfer in", tone: "blue" },
	COUNT_VARIANCE: { label: "Count variance", tone: "zinc" },
	// Added with the POS: a sale is a ledger movement like any other, and the history table
	// must render it instead of throwing on a missing label.
	SALE: { label: "Sale", tone: "blue" },
}

/**
 * The stock list's filters live in the URL, so the operations page can link the low-stock queue it
 * counted. `lowStock` is a string literal because it is a URL value, not a boolean.
 */
export const stockSearchSchema = z.object({
	lowStock: z.literal("true").optional().catch(undefined),
	branchId: z.uuid().optional().catch(undefined),
})

export type StockSearch = z.infer<typeof stockSearchSchema>

export const stockSearchDefaults = {} as const
