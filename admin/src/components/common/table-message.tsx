import { cn } from "cn"
import { Skeleton } from "#/components/ui/skeleton"
import { TableCell, TableRow } from "#/components/ui/table"

export type TableMessageState = "muted" | "error" | "empty" | "loading"

const TEXT_CLASSES: Record<Exclude<TableMessageState, "loading">, string> = {
	muted: "text-muted-foreground",
	empty: "text-muted-foreground",
	error: "text-destructive",
}

/**
 * The placeholder row for a table that has no data yet. `tone` is the original
 * API; `state` adds the empty/loading distinction and `rows` lets the loading
 * state reserve the height of the rows that are about to arrive, so nothing
 * shifts when the data lands.
 */
export function TableMessage({
	colSpan,
	children,
	tone = "muted",
	state,
	rows = 1,
}: {
	colSpan: number
	children?: React.ReactNode
	tone?: "muted" | "error"
	state?: TableMessageState
	rows?: number
}) {
	const resolved: TableMessageState = state ?? tone

	if (resolved === "loading") {
		return (
			<>
				{/* One live region, separate from the visual rows: the `sr-only` cell
				    takes the row out of flow and `border-0` drops its rule, so the
				    `rows` skeletons keep the exact height of the data that follows. */}
				<TableRow className="border-0">
					<TableCell colSpan={colSpan} className="sr-only">
						<output>{children ?? "Loading…"}</output>
					</TableCell>
				</TableRow>
				{Array.from({ length: rows }, (_, index) => `skeleton-${index}`).map((rowKey) => (
					<TableRow key={rowKey} aria-hidden="true">
						<TableCell colSpan={colSpan} className="px-2 py-2.5">
							<Skeleton className="h-4 w-full max-w-48" />
						</TableCell>
					</TableRow>
				))}
			</>
		)
	}

	return (
		<TableRow>
			<TableCell
				colSpan={colSpan}
				className={cn("py-8 text-center text-sm", TEXT_CLASSES[resolved])}
			>
				{children}
			</TableCell>
		</TableRow>
	)
}
