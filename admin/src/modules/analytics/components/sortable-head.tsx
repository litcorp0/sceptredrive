import { Link } from "@tanstack/react-router"
import { ArrowDown, ArrowUp } from "lucide-react"
import { TableHead } from "#/components/ui/table"

interface SortableHeadProps {
	label: string
	/** The API's sort key for this column. */
	sortKey: string
	currentSort: string | undefined
	currentDirection: "asc" | "desc" | undefined
	align?: "left" | "right"
}

/**
 * A sortable column header that is a real link with `aria-sort`.
 *
 * Sorting is server-side: the row set is paged, so sorting the page in the browser would sort
 * twenty rows and call it a report.
 */
export function SortableHead({
	label,
	sortKey,
	currentSort,
	currentDirection,
	align,
}: SortableHeadProps) {
	const active = currentSort === sortKey
	const direction = active ? (currentDirection ?? "desc") : undefined
	const nextDirection = active && direction === "desc" ? "asc" : "desc"

	return (
		<TableHead
			scope="col"
			aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}
			className={align === "right" ? "text-right" : undefined}
		>
			<Link
				to="."
				search={(prev) => ({
					...prev,
					sort: sortKey,
					direction: nextDirection,
					offset: undefined,
				})}
				className="inline-flex items-center gap-1 hover:text-foreground"
			>
				{label}
				{active ? (
					direction === "asc" ? (
						<ArrowUp aria-hidden="true" className="size-3" />
					) : (
						<ArrowDown aria-hidden="true" className="size-3" />
					)
				) : null}
			</Link>
		</TableHead>
	)
}
