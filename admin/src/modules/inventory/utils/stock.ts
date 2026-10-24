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
}
