import { accraIsoDay } from "@sceptre/shared"
import { z } from "zod"
import type { AnalyticsQuery, Granularity, ReportQuery } from "../types"

export const ANALYTICS_TABS = [
	"sales",
	"products",
	"inventory",
	"credit",
	"loyalty",
	"payables",
	"tax",
] as const

export const GRANULARITIES = ["day", "week", "month"] as const

/**
 * The whole view lives in the URL.
 *
 * `.catch()` rather than `.default()`: a hand-edited or truncated link must render the page
 * with a sane fallback, never throw. Period defaults are resolved at render time because
 * "the last 30 days" depends on today.
 */
export const analyticsSearchSchema = z.object({
	tab: z.enum(ANALYTICS_TABS).optional().catch(undefined),
	from: z.iso.date().optional().catch(undefined),
	to: z.iso.date().optional().catch(undefined),
	granularity: z.enum(GRANULARITIES).optional().catch(undefined),
	branchId: z.uuid().optional().catch(undefined),
	sort: z.string().max(24).optional().catch(undefined),
	direction: z.enum(["asc", "desc"]).optional().catch(undefined),
	offset: z.coerce.number().int().min(0).optional().catch(undefined),
})

export type AnalyticsSearch = z.infer<typeof analyticsSearchSchema>

/** Values `stripSearchParams` removes so a default view is a clean URL. */
export const analyticsSearchDefaults = { tab: "sales", granularity: "day" } as const

export const dashboardSearchSchema = analyticsSearchSchema.omit({
	tab: true,
	sort: true,
	direction: true,
	offset: true,
})
export const dashboardSearchDefaults = { granularity: "day" } as const

const MAX_SPAN_DAYS = 366
const DAY_MS = 86_400_000

function parseDay(value: string): Date {
	return new Date(`${value}T00:00:00.000Z`)
}

function isoDay(value: Date): string {
	return value.toISOString().slice(0, 10)
}

function addDays(value: Date, days: number): Date {
	return new Date(value.getTime() + days * DAY_MS)
}

export type PeriodPreset = "today" | "7d" | "30d" | "this-month" | "last-month"

export const PERIOD_PRESETS: ReadonlyArray<{ id: PeriodPreset; label: string }> = [
	{ id: "today", label: "Today" },
	{ id: "7d", label: "7 days" },
	{ id: "30d", label: "30 days" },
	{ id: "this-month", label: "This month" },
	{ id: "last-month", label: "Last month" },
]

/**
 * Presets produce **absolute** dates. A relative `?preset=30d` would show a different window
 * tomorrow, so a link could never be trusted; a copied URL must reproduce the view.
 */
export function applyPreset(preset: PeriodPreset, now = new Date()): { from: string; to: string } {
	const today = parseDay(accraIsoDay(now))
	if (preset === "today") return { from: isoDay(today), to: isoDay(today) }
	if (preset === "7d") return { from: isoDay(addDays(today, -6)), to: isoDay(today) }
	if (preset === "30d") return { from: isoDay(addDays(today, -29)), to: isoDay(today) }

	const firstOfThisMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
	if (preset === "this-month") {
		return { from: isoDay(firstOfThisMonth), to: isoDay(today) }
	}
	const firstOfLastMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
	const lastOfLastMonth = addDays(firstOfThisMonth, -1)
	return { from: isoDay(firstOfLastMonth), to: isoDay(lastOfLastMonth) }
}

/**
 * Resolve the URL's period into the range the API accepts.
 *
 * A missing, reversed, or over-long range falls back to the last 30 days rather than
 * rendering an error page: a broken link should still show the business. The API validates
 * again, so this is convenience, not enforcement.
 */
export function resolvePeriod(
	search: Pick<AnalyticsSearch, "from" | "to">,
	now = new Date(),
): { from: string; to: string } {
	const fallback = applyPreset("30d", now)
	const from = search.from ?? fallback.from
	const to = search.to ?? fallback.to
	if (from > to) return fallback
	const span = Math.round((parseDay(to).getTime() - parseDay(from).getTime()) / DAY_MS) + 1
	if (span > MAX_SPAN_DAYS) return fallback
	return { from, to }
}

export function toAnalyticsQuery(
	search: AnalyticsSearch,
	branchId: string | undefined,
	now = new Date(),
): AnalyticsQuery {
	const { from, to } = resolvePeriod(search, now)
	return { from, to, granularity: (search.granularity ?? "day") as Granularity, branchId }
}

export function toReportQuery(
	search: AnalyticsSearch,
	branchId: string | undefined,
	options: { limit?: number } = {},
): ReportQuery {
	return {
		...toAnalyticsQuery(search, branchId),
		sort: search.sort,
		direction: search.direction,
		limit: options.limit,
		offset: search.offset,
	}
}

/** `2026-09-25 → 2026-10-24` for a heading; display only. */
export function periodLabel(period: { from: string; to: string }): string {
	return period.from === period.to ? period.from : `${period.from} → ${period.to}`
}
