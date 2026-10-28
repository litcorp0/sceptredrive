import { REFUND_REASONS, TENDER_METHODS } from "@sceptre/shared"
import { z } from "zod"

/** The four documents a manager reviews at head office, in the order the nav shows them. */
export const POS_TABS = ["sales", "refunds", "shifts", "conflicts"] as const
export type PosTab = (typeof POS_TABS)[number]

export const CONFLICT_STATUSES = ["OPEN", "RESOLVED", "DISMISSED", "ALL"] as const
export const CONFLICT_SEVERITIES = ["HIGH", "MEDIUM", "LOW"] as const
export const REFUND_TENDER_STATUSES = ["SETTLED", "PENDING", "FAILED", "NEEDS_ATTENTION"] as const
export const SHIFT_STATUSES = ["OPEN", "CLOSED"] as const
export const SHIFT_REVIEW_STATUSES = ["NONE", "REQUIRED", "REVIEWED"] as const

/**
 * The whole oversight view lives in the URL.
 *
 * These screens are sent to colleagues: a filter that lives in `useState` cannot be
 * shared, and a bookmarked `/pos?tab=conflicts` must open the queue. `.catch()` rather
 * than `.default()` means a hand-edited or truncated link renders a sane fallback
 * instead of an error boundary. The API validates every filter again.
 */
export const posSearchSchema = z.object({
	tab: z.enum(POS_TABS).optional().catch(undefined),
	from: z.iso.date().optional().catch(undefined),
	to: z.iso.date().optional().catch(undefined),
	terminalId: z.uuid().optional().catch(undefined),
	receiptNumber: z.string().trim().max(60).optional().catch(undefined),
	status: z.enum(CONFLICT_STATUSES).optional().catch(undefined),
	severity: z.enum(CONFLICT_SEVERITIES).optional().catch(undefined),
	reasonCode: z.enum(REFUND_REASONS).optional().catch(undefined),
	method: z.enum(TENDER_METHODS).optional().catch(undefined),
	tenderStatus: z.enum(REFUND_TENDER_STATUSES).optional().catch(undefined),
	shiftStatus: z.enum(SHIFT_STATUSES).optional().catch(undefined),
	reviewStatus: z.enum(SHIFT_REVIEW_STATUSES).optional().catch(undefined),
	/** A link from a sale's conflict list narrows the queue without a second screen. */
	saleId: z.uuid().optional().catch(undefined),
	shiftId: z.uuid().optional().catch(undefined),
	offset: z.coerce.number().int().min(0).optional().catch(undefined),
})

export type PosSearch = z.infer<typeof posSearchSchema>

/** Values `stripSearchParams` removes so the default queue is a clean URL. */
export const posSearchDefaults = { tab: "sales" } as const

/** The tab a URL names, or the sales list when it names none. */
export function resolveTab(tab: PosSearch["tab"]): PosTab {
	return tab ?? "sales"
}
