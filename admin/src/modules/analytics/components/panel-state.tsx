import { Skeleton } from "#/components/ui/skeleton"

interface PanelStateProps {
	state: "loading" | "error" | "empty"
	/** Names the failed panel so a screen reader never reports a bare "Error". */
	label: string
	message?: string
	onRetry?: () => void
	rows?: number
}

/**
 * The three honest states every panel has.
 *
 * Loading mirrors the final layout with skeleton blocks so the page does not jump; an error
 * names the panel and offers a retry; empty explains how data will appear. A brand-new shop
 * must never see something that looks broken.
 */
export function PanelState({ state, label, message, onRetry, rows = 3 }: PanelStateProps) {
	if (state === "loading") {
		return (
			<div className="grid gap-3" aria-busy="true">
				<output className="sr-only">{label} is loading</output>
				{Array.from({ length: rows }, (_, index) => (
					<Skeleton key={index} className="h-12 w-full" />
				))}
			</div>
		)
	}

	if (state === "error") {
		return (
			<div className="rounded-lg border border-dashed p-4">
				<p className="text-sm text-destructive">{label} could not be loaded.</p>
				<p className="mt-1 text-xs text-muted-foreground">
					{message ?? "The server did not answer. Try again in a moment."}
				</p>
				{onRetry ? (
					<button
						type="button"
						className="mt-3 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
						onClick={onRetry}
					>
						Retry
					</button>
				) : null}
			</div>
		)
	}

	return (
		<div className="rounded-lg border border-dashed p-6 text-center">
			<p className="text-sm font-medium">{label} is empty for this period</p>
			<p className="mt-1 text-xs text-muted-foreground">
				{message ?? "Figures appear here once a terminal uploads a sale in this window."}
			</p>
		</div>
	)
}
