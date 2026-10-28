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
	// Phase 11: goods sent back to a supplier are an outbound movement, not a loss.
	SUPPLIER_RETURN: { label: "Supplier return", tone: "blue" },
	// Phase 12: a posted write-off is stock the branch no longer has, so it reads as a loss.
	WRITE_OFF: { label: "Write-off", tone: "red" },
	// Phase 13: a resalable refund line put the goods back into sellable stock.
	RETURN: { label: "Return", tone: "green" },
}

/**
 * The stock list's filters live in the URL, so the operations page can link the low-stock queue it
 * counted. `lowStock` is a string literal because it is a URL value, not a boolean.
 *
 * `report=true` is the report mode (P14-D16) rather than a second route: the same screen, one
 * flag. `reportBranch=all` is the admin's all-branch report, which the paged list cannot do
 * (its API requires a branch), so it is a separate value rather than an overload of `branchId`.
 */
export const stockSearchSchema = z.object({
	lowStock: z.literal("true").optional().catch(undefined),
	branchId: z.uuid().optional().catch(undefined),
	report: z.literal("true").optional().catch(undefined),
	reportBranch: z
		.union([z.uuid(), z.literal("all")])
		.optional()
		.catch(undefined),
	categoryId: z.uuid().optional().catch(undefined),
	from: z.iso.date().optional().catch(undefined),
	to: z.iso.date().optional().catch(undefined),
})

export type StockSearch = z.infer<typeof stockSearchSchema>

export const stockSearchDefaults = {} as const
