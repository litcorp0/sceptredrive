import { formatCount } from '@sceptre/shared'
import { Bar, BarChart, Cell, XAxis, YAxis } from 'recharts'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { usePrefersReducedMotion } from '@/hooks/use-prefers-reduced-motion'
import { formatGhs } from '@/lib/format'
import type { HourPoint } from '../types'
import { hourLabel } from '../utils/day'

/**
 * The day's shape (P10-D14).
 *
 * Twenty-four bars, one per Accra hour, and **only the current hour is brand orange**. That is
 * the whole legend: the chart answers "where are we right now" without a hover, a tooltip, or a
 * second colour decision, and the summary sentence beneath answers "when was it busiest"
 * without one either.
 *
 * Accessibility follows Phase 9's rule rather than the older gallery's:
 *
 * - `accessibilityLayer` is left at Recharts 3.x's default (`true`). Setting it false removes
 *   the keyboard navigation and the ARIA semantics.
 * - **No `role="img"` on the wrapper.** Phase 9 measured that it mutes the accessibility layer
 *   the library adds underneath.
 * - The summary sentence and the `<details>` table are the description and the data
 *   alternative the layer does not supply by itself.
 * - Animation is off under `prefers-reduced-motion` (P10-D8).
 *
 * The panel is `bg-card`, not the canvas: the bar colours are measured to 3:1 against the
 * surface (P9-D3).
 */
export function HourChart({
  points,
  peak,
  currentHour,
}: {
  points: HourPoint[]
  peak: number | null
  currentHour: number
}) {
  const reduced = usePrefersReducedMotion()
  const data = points.map((point) => ({ hour: point.hour, take: point.takeMinor }))
  const peakTake = points.find((point) => point.hour === peak)?.takeMinor ?? 0

  const summary =
    peak === null
      ? 'No sales yet today on this terminal.'
      : `Busiest at ${hourLabel(peak)} with ${formatGhs(peakTake)}.`

  return (
    <section
      aria-labelledby="home-hour-heading"
      className="rounded-lg border border-border bg-card p-4"
    >
      <h2 id="home-hour-heading" className="text-sm font-semibold">
        Sales by hour
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        GHS by hour · today on this terminal · the orange bar is now ({hourLabel(currentHour)})
      </p>

      <ChartContainer
        config={chartConfig}
        className="mt-3 h-40 w-full xl:h-48"
        data-testid="home-hour-chart"
      >
        <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap={2}>
          <XAxis
            dataKey="hour"
            tickLine={false}
            axisLine={false}
            interval={2}
            tickMargin={6}
            tickFormatter={(hour: number) => String(hour).padStart(2, '0')}
          />
          <YAxis
            width={52}
            tickLine={false}
            axisLine={false}
            tickFormatter={(minor: number) => formatCount(Math.round(minor / 100))}
          />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(label) => hourLabel(Number(label))}
                formatter={(value) => formatGhs(Number(value))}
              />
            }
          />
          <Bar
            dataKey="take"
            fill="var(--color-take)"
            radius={[2, 2, 0, 0]}
            isAnimationActive={!reduced}
            animationDuration={200}
          >
            {data.map((point) => (
              <Cell
                key={point.hour}
                fill={point.hour === currentHour ? 'var(--color-take)' : 'var(--chart-3)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ChartContainer>

      <p className="mt-2 text-sm text-muted-foreground" data-testid="home-hour-summary">
        {summary}
      </p>

      <details className="group mt-1" data-testid="home-hour-details">
        <summary className="flex h-11 cursor-pointer list-none items-center text-xs font-medium text-brand-ink underline underline-offset-4 hover:no-underline">
          All 24 hours
          <span aria-hidden="true" className="ml-1 transition-transform group-open:rotate-180">
            ▾
          </span>
        </summary>
        <div className="max-h-56 overflow-y-auto">
          <table className="w-full text-xs">
            <caption className="sr-only">Take by hour, today on this terminal</caption>
            <thead className="text-left text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 font-medium">
                  Hour
                </th>
                <th scope="col" className="py-1 text-right font-medium">
                  Take
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {points.map((point) => (
                <tr key={point.hour} data-testid="home-hour-row">
                  <td className="py-1 font-mono tabular-nums">{hourLabel(point.hour)}</td>
                  <td className="py-1 text-right font-mono tabular-nums">
                    {formatGhs(point.takeMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  )
}

const chartConfig = {
  take: { label: 'Take', color: 'var(--chart-1)' },
} satisfies ChartConfig
