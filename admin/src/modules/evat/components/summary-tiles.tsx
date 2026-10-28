import { formatCount } from "@sceptre/shared"
import { Card, CardDescription, CardHeader, CardTitle } from "#/components/ui/card"
import { Skeleton } from "#/components/ui/skeleton"
import type { EvatSummary } from "../types"
import { formatDurationMinutes } from "../utils/labels"

/**
 * The five counts the API resolves for the signed-in scope. `Overdue` is the only tile that can
 * be non-zero while nothing is failing: the deadline is a statutory boundary, not a retry cap
 * (P14-D36). Its subtitle names the oldest one so the number is actionable.
 */
export function EvatSummaryTiles({
	summary,
	isLoading,
	isError,
	requestId,
}: {
	summary: EvatSummary | undefined
	isLoading: boolean
	isError: boolean
	requestId: string | undefined
}) {
	if (isLoading) {
		return (
			<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5" aria-busy="true">
				<output className="sr-only">Loading the E-VAT summary</output>
				{["queued", "certified", "retrying", "attention", "overdue"].map((key) => (
					<Card key={key}>
						<CardHeader>
							<Skeleton className="h-3 w-20" />
							<Skeleton className="h-7 w-12" />
						</CardHeader>
					</Card>
				))}
			</div>
		)
	}

	if (isError || !summary) {
		return (
			<p
				role="alert"
				className="rounded-md border border-destructive/40 p-3 text-sm text-destructive"
			>
				Couldn&rsquo;t load the E-VAT summary.{requestId ? ` Request ${requestId}.` : ""}
			</p>
		)
	}

	return (
		<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
			<Card>
				<CardHeader>
					<CardDescription>Queued</CardDescription>
					<CardTitle className="text-2xl tabular-nums">{formatCount(summary.queued)}</CardTitle>
					<p className="text-xs text-muted-foreground">waiting for their first attempt</p>
				</CardHeader>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>Certified</CardDescription>
					<CardTitle className="text-2xl tabular-nums">{formatCount(summary.certified)}</CardTitle>
					<p className="text-xs text-muted-foreground">stamped by GRA</p>
				</CardHeader>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>Retrying</CardDescription>
					<CardTitle className="text-2xl tabular-nums">{formatCount(summary.retrying)}</CardTitle>
					<p className="text-xs text-muted-foreground">on the backoff ladder</p>
				</CardHeader>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>Needs attention</CardDescription>
					<CardTitle
						className={
							summary.attention > 0
								? "text-2xl tabular-nums text-destructive"
								: "text-2xl tabular-nums"
						}
					>
						{formatCount(summary.attention)}
					</CardTitle>
					<p className="text-xs text-muted-foreground">refused, or the ladder is exhausted</p>
				</CardHeader>
			</Card>
			<Card>
				<CardHeader>
					<CardDescription>Overdue</CardDescription>
					<CardTitle
						className={
							summary.overdue > 0
								? "text-2xl tabular-nums text-destructive"
								: "text-2xl tabular-nums"
						}
					>
						{formatCount(summary.overdue)}
					</CardTitle>
					<p className="text-xs text-muted-foreground">
						{summary.oldestOverdueMinutes === null
							? "none past the 24-hour deadline"
							: `oldest ${formatDurationMinutes(summary.oldestOverdueMinutes)}`}
					</p>
				</CardHeader>
			</Card>
		</div>
	)
}
