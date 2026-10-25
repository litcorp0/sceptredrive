import { formatCount } from "@sceptre/shared"
import type { ReactNode } from "react"
import { Line, LineChart } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { type ChartConfig, ChartContainer } from "#/components/ui/chart"
import type { MoneyDelta } from "../types"
import { usePrefersReducedMotion } from "../utils/motion"
import { DeltaBadge } from "./delta-badge"

interface KpiTileProps {
	label: string
	/** Already formatted — money through `formatGhs`, counts through `formatCount`. */
	value: string
	detail?: string
	delta?: MoneyDelta
	/** The subject for the delta's screen-reader text. */
	subject?: string
	spark?: Array<{ bucketStart: string; value: number }>
}

const sparkConfig = {
	value: { label: "Trend", color: "var(--chart-1)" },
} satisfies ChartConfig

/**
 * One number, its comparison, and optionally its shape. The sparkline is decorative: it has
 * no axes and no tooltip, so it is hidden from assistive technology and the exact figures
 * live in the data table of the chart that owns the series.
 */
export function KpiTile({ label, value, detail, delta, subject, spark }: KpiTileProps) {
	const reduced = usePrefersReducedMotion()
	return (
		<Card className="min-w-0">
			<CardHeader>
				<CardDescription>{label}</CardDescription>
				<CardTitle className="font-display text-2xl tabular-nums">{value}</CardTitle>
				{delta ? (
					<DeltaBadge deltaBp={delta.deltaBp} subject={subject ?? label.toLowerCase()} />
				) : null}
			</CardHeader>
			<CardContent className="pt-0">
				{spark && spark.length > 1 ? (
					<div aria-hidden="true" className="h-11">
						<ChartContainer config={sparkConfig} className="h-11 w-full">
							<LineChart data={spark} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
								<Line
									dataKey="value"
									type="monotone"
									stroke="var(--color-value)"
									strokeWidth={2}
									dot={false}
									isAnimationActive={!reduced}
								/>
							</LineChart>
						</ChartContainer>
					</div>
				) : null}
				{detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
			</CardContent>
		</Card>
	)
}

export function KpiRow({ children }: { children: ReactNode }) {
	return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
}

/** Display-only helper so a tile never divides money itself. */
export function countLabel(value: number): string {
	return formatCount(value)
}
