import { formatCount } from "@sceptre/shared"
import { createFileRoute, notFound } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import {
	Area,
	AreaChart,
	Bar,
	BarChart,
	CartesianGrid,
	Line,
	LineChart,
	XAxis,
	YAxis,
} from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
	ChartTooltipContent,
} from "#/components/ui/chart"
import { formatGhs } from "#/lib/format"

/**
 * Chart-layer proof (Phase 7 Plan 04). Development only.
 *
 * Static fixtures, no API. It exists to prove that the registry `chart` wrapper,
 * the brand ramp and dark mode all agree before Phase 9 wires real read models.
 *
 * TODO(phase-9): delete this route when the analytics dashboard ships.
 */
export const Route = createFileRoute("/dev-charts")({
	beforeLoad: () => {
		// A production build must not expose a fixture page.
		if (!import.meta.env.DEV) throw notFound()
	},
	component: DevChartsPage,
})

/** Display-only conversion: data stays in integer pesewas (D12). */
const ghs = formatGhs

function cedis(minor: number): string {
	return formatCount(Math.round(minor / 100))
}

function usePrefersReducedMotion(): boolean {
	// SSR-safe: the server has no `window`, so it renders the animated default and
	// the effect corrects it on mount (before the first paint completes).
	const [reduced, setReduced] = useState(
		() =>
			typeof window !== "undefined" &&
			window.matchMedia("(prefers-reduced-motion: reduce)").matches,
	)
	useEffect(() => {
		const query = window.matchMedia("(prefers-reduced-motion: reduce)")
		const onChange = () => setReduced(query.matches)
		query.addEventListener("change", onChange)
		return () => query.removeEventListener("change", onChange)
	}, [])
	return reduced
}

const revenue = [
	{ month: "May", sales: 4_820_000, cost: 3_140_000 },
	{ month: "Jun", sales: 5_640_000, cost: 3_610_000 },
	{ month: "Jul", sales: 5_120_000, cost: 3_360_000 },
	{ month: "Aug", sales: 6_980_000, cost: 4_190_000 },
	{ month: "Sep", sales: 7_440_000, cost: 4_520_000 },
	{ month: "Oct", sales: 8_260_000, cost: 4_980_000 },
]

const revenueConfig = {
	sales: { label: "Sales", color: "var(--chart-1)" },
	cost: { label: "Cost of goods", color: "var(--chart-2)" },
} satisfies ChartConfig

const tenderMix = [
	{ week: "W40", cash: 2_140_000, credit: 1_260_000, momo: 980_000 },
	{ week: "W41", cash: 2_320_000, credit: 1_410_000, momo: 1_120_000 },
	{ week: "W42", cash: 1_980_000, credit: 1_180_000, momo: 1_340_000 },
	{ week: "W43", cash: 2_610_000, credit: 1_520_000, momo: 1_460_000 },
	{ week: "W44", cash: 2_880_000, credit: 1_640_000, momo: 1_710_000 },
]

const tenderConfig = {
	cash: { label: "Cash", color: "var(--chart-1)" },
	credit: { label: "Credit", color: "var(--chart-2)" },
	momo: { label: "Mobile money", color: "var(--chart-3)" },
} satisfies ChartConfig

const topProducts = [
	{ product: "Brake pad set", units: 184_000 },
	{ product: "Engine oil 5W-30", units: 156_000 },
	{ product: "Oil filter", units: 121_000 },
	{ product: "Spark plug", units: 94_000 },
	{ product: "Wiper blade", units: 61_000 },
]

const topProductConfig = {
	units: { label: "Revenue", color: "var(--chart-1)" },
} satisfies ChartConfig

const sparkline = [
	{ day: "Mon", value: 820_000 },
	{ day: "Tue", value: 940_000 },
	{ day: "Wed", value: 760_000 },
	{ day: "Thu", value: 1_120_000 },
	{ day: "Fri", value: 1_480_000 },
	{ day: "Sat", value: 1_960_000 },
	{ day: "Sun", value: 640_000 },
]

const sparkConfig = {
	value: { label: "Today", color: "var(--chart-1)" },
} satisfies ChartConfig

function ChartCard({
	title,
	description,
	label,
	children,
}: {
	title: string
	description: string
	label: string
	children: React.ReactNode
}) {
	return (
		<Card className="min-w-0">
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>
				<div role="img" aria-label={label}>
					{children}
				</div>
			</CardContent>
		</Card>
	)
}

function DevChartsPage() {
	const reduced = usePrefersReducedMotion()
	const animate = !reduced

	return (
		<main className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
			<header>
				<p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
					Development only
				</p>
				<h1 className="mt-1 text-2xl font-semibold tracking-tight">Chart layer proof</h1>
				<p className="mt-1 text-sm text-muted-foreground">
					Static fixtures — the brand ramp, tooltips, and dark mode before Phase 9.
				</p>
			</header>

			<div className="grid gap-6 lg:grid-cols-2">
				<ChartCard
					title="Revenue vs cost"
					description="Last six months, integer pesewas"
					label="Area chart of monthly sales and cost of goods from May to October"
				>
					<ChartContainer config={revenueConfig} className="min-h-[240px] w-full">
						<AreaChart accessibilityLayer data={revenue} margin={{ left: 4, right: 16 }}>
							<CartesianGrid vertical={false} />
							<XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} />
							<YAxis
								tickLine={false}
								axisLine={false}
								width={64}
								tickFormatter={(value: number) => cedis(value)}
							/>
							<ChartTooltip
								content={
									<ChartTooltipContent formatter={(value) => ghs(Number(value))} indicator="line" />
								}
							/>
							<Area
								dataKey="sales"
								type="natural"
								fill="var(--color-sales)"
								fillOpacity={0.18}
								stroke="var(--color-sales)"
								strokeWidth={2}
								isAnimationActive={animate}
							/>
							<Area
								dataKey="cost"
								type="natural"
								fill="var(--color-cost)"
								fillOpacity={0.12}
								stroke="var(--color-cost)"
								strokeWidth={2}
								isAnimationActive={animate}
							/>
						</AreaChart>
					</ChartContainer>
				</ChartCard>

				<ChartCard
					title="Tender mix"
					description="Cash, credit, and mobile money by week"
					label="Stacked bar chart of weekly takings split by cash, credit, and mobile money"
				>
					<ChartContainer config={tenderConfig} className="min-h-[240px] w-full">
						<BarChart accessibilityLayer data={tenderMix} margin={{ left: 4, right: 16 }}>
							<CartesianGrid vertical={false} />
							<XAxis dataKey="week" tickLine={false} axisLine={false} tickMargin={8} />
							<YAxis
								tickLine={false}
								axisLine={false}
								width={64}
								tickFormatter={(value: number) => cedis(value)}
							/>
							<ChartTooltip
								content={<ChartTooltipContent formatter={(value) => ghs(Number(value))} />}
							/>
							<Bar
								dataKey="cash"
								stackId="tender"
								fill="var(--color-cash)"
								isAnimationActive={animate}
							/>
							<Bar
								dataKey="credit"
								stackId="tender"
								fill="var(--color-credit)"
								isAnimationActive={animate}
							/>
							<Bar
								dataKey="momo"
								stackId="tender"
								fill="var(--color-momo)"
								radius={[4, 4, 0, 0]}
								isAnimationActive={animate}
							/>
						</BarChart>
					</ChartContainer>
				</ChartCard>

				<ChartCard
					title="Top products"
					description="Revenue this month"
					label="Horizontal bar chart of the five highest-revenue products this month"
				>
					<ChartContainer config={topProductConfig} className="min-h-[240px] w-full">
						<BarChart
							accessibilityLayer
							data={topProducts}
							layout="vertical"
							margin={{ left: 4, right: 12 }}
						>
							<CartesianGrid horizontal={false} />
							<XAxis
								type="number"
								tickLine={false}
								axisLine={false}
								tickFormatter={(value: number) => cedis(value)}
							/>
							<YAxis
								dataKey="product"
								type="category"
								tickLine={false}
								axisLine={false}
								width={104}
							/>
							<ChartTooltip
								content={<ChartTooltipContent formatter={(value) => ghs(Number(value))} />}
							/>
							<Bar
								dataKey="units"
								fill="var(--color-units)"
								radius={[0, 4, 4, 0]}
								isAnimationActive={animate}
							/>
						</BarChart>
					</ChartContainer>
				</ChartCard>

				<Card className="min-w-0 self-start">
					<CardHeader>
						<CardDescription>Today&rsquo;s takings</CardDescription>
						<p className="font-mono text-2xl font-semibold tabular-nums" data-money>
							{ghs(sparkline[5]?.value ?? 0)}
						</p>
					</CardHeader>
					<CardContent>
						<div role="img" aria-label="Sparkline of daily takings for the last seven days">
							<ChartContainer config={sparkConfig} className="h-[88px] w-full">
								<LineChart accessibilityLayer data={sparkline}>
									<ChartTooltip
										content={
											<ChartTooltipContent hideLabel formatter={(value) => ghs(Number(value))} />
										}
									/>
									<Line
										dataKey="value"
										type="monotone"
										stroke="var(--color-value)"
										strokeWidth={2}
										dot={false}
										isAnimationActive={animate}
									/>
								</LineChart>
							</ChartContainer>
						</div>
					</CardContent>
				</Card>
			</div>
		</main>
	)
}
