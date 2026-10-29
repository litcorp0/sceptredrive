import { type ReactNode, useId } from "react"
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "#/components/ui/table"

export interface ChartTableColumn {
	key: string
	label: string
	align?: "left" | "right"
}

export interface ChartTable {
	caption: string
	columns: ChartTableColumn[]
	rows: Array<Record<string, string | number>>
}

/**
 * The data-table alternative every chart carries.
 *
 * Recharts draws an SVG; a screen reader (or a reader who cannot distinguish the ramp) gets
 * the same numbers here, inside a real table with a caption. Values are passed pre-formatted
 * because the chart's caller already knows whether a cell is money, a count, or a label.
 */
export function ChartDataTable({ table }: { table: ChartTable }) {
	return (
		<Table>
			<caption className="sr-only">{table.caption}</caption>
			<TableHeader>
				<TableRow>
					{table.columns.map((column) => (
						<TableHead
							key={column.key}
							scope="col"
							className={column.align === "right" ? "text-right" : undefined}
						>
							{column.label}
						</TableHead>
					))}
				</TableRow>
			</TableHeader>
			<TableBody>
				{table.rows.map((row, index) => (
					<TableRow key={index}>
						{table.columns.map((column) => (
							<TableCell
								key={column.key}
								className={
									column.align === "right" ? "text-right font-mono tabular-nums" : undefined
								}
							>
								{row[column.key] ?? ""}
							</TableCell>
						))}
					</TableRow>
				))}
			</TableBody>
		</Table>
	)
}

interface ChartCardProps {
	title: string
	/** One sentence stating what the chart shows, in words rather than hover. */
	summary: string
	children: ReactNode
	table: ChartTable
	/** Extra context under the title, e.g. the axis units. */
	description?: string
}

export function ChartCard({ title, summary, description, children, table }: ChartCardProps) {
	const titleId = useId()
	return (
		<figure aria-labelledby={titleId} className="min-w-0 rounded-lg border bg-card p-4">
			<figcaption className="mb-2">
				<h3 id={titleId} className="text-sm font-semibold tracking-tight">
					{title}
				</h3>
				{description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
				<p className="mt-1 text-xs text-muted-foreground">{summary}</p>
			</figcaption>
			{/*
			 * A named `<figure>`, not `role="img"`: the Recharts accessibility layer inside is
			 * focusable and announces data points, and `role="img"` would hide those descendants
			 * from assistive technology. The caption names the chart; the data table repeats it.
			 */}
			<div className="min-w-0">{children}</div>
			<details className="mt-3 text-xs">
				<summary className="cursor-pointer select-none font-medium text-muted-foreground hover:text-foreground">
					View data table
				</summary>
				<div className="mt-2 overflow-x-auto">
					<ChartDataTable table={table} />
				</div>
			</details>
		</figure>
	)
}
