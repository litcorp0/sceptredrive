import { Button } from "#/components/ui/button"

export function Pagination({
	total,
	limit,
	offset,
	onOffsetChange,
}: {
	total: number
	limit: number
	offset: number
	onOffsetChange: (offset: number) => void
}) {
	const start = total === 0 ? 0 : offset + 1
	const end = Math.min(offset + limit, total)
	const canPrev = offset > 0
	const canNext = offset + limit < total

	return (
		<div className="flex items-center justify-between gap-3 px-1 py-2 text-sm text-muted-foreground">
			<span className="font-mono text-xs tabular-nums">
				{start}–{end} of {total}
			</span>
			<div className="flex gap-2">
				<Button
					variant="outline"
					size="sm"
					disabled={!canPrev}
					onClick={() => onOffsetChange(Math.max(0, offset - limit))}
				>
					Previous
				</Button>
				<Button
					variant="outline"
					size="sm"
					disabled={!canNext}
					onClick={() => onOffsetChange(offset + limit)}
				>
					Next
				</Button>
			</div>
		</div>
	)
}
