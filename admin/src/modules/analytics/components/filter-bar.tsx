import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import { Label } from "#/components/ui/label"
import { ToggleGroup, ToggleGroupItem } from "#/components/ui/toggle-group"
import type { AnalyticsSearch } from "../utils/search"
import { applyPreset, PERIOD_PRESETS, resolvePeriod } from "../utils/search"

interface FilterBarProps {
	search: AnalyticsSearch
	/** Writes a patch to the URL; the page owns navigation. */
	onChange: (patch: Partial<AnalyticsSearch>) => void
	/** Read-only branch label; the header switcher is the single branch control. */
	branchLabel: string
}

/**
 * Period and granularity, all in the URL.
 *
 * Presets write absolute dates, so the link shows the same window tomorrow. Changing any
 * filter resets pagination, because page 3 of a different period is meaningless.
 */
export function FilterBar({ search, onChange, branchLabel }: FilterBarProps) {
	const resolved = resolvePeriod(search)
	const activePreset = PERIOD_PRESETS.find((preset) => {
		const range = applyPreset(preset.id)
		return range.from === resolved.from && range.to === resolved.to
	})

	return (
		<div className="flex flex-wrap items-end gap-3">
			<fieldset className="flex flex-wrap gap-1">
				<legend className="sr-only">Period presets</legend>
				{PERIOD_PRESETS.map((preset) => (
					<Button
						key={preset.id}
						type="button"
						size="sm"
						variant={activePreset?.id === preset.id ? "default" : "outline"}
						aria-pressed={activePreset?.id === preset.id}
						onClick={() => {
							const range = applyPreset(preset.id)
							onChange({ ...range, offset: undefined })
						}}
					>
						{preset.label}
					</Button>
				))}
			</fieldset>

			<div className="flex w-full flex-wrap items-end gap-2 sm:w-auto">
				<div className="grid min-w-0 flex-1 gap-1 sm:flex-none">
					<Label htmlFor="analytics-from" className="text-xs">
						From
					</Label>
					<Input
						id="analytics-from"
						type="date"
						className="w-full sm:w-40"
						value={resolved.from}
						max={resolved.to}
						onChange={(event) => onChange({ from: event.target.value, offset: undefined })}
					/>
				</div>
				<div className="grid min-w-0 flex-1 gap-1 sm:flex-none">
					<Label htmlFor="analytics-to" className="text-xs">
						To
					</Label>
					<Input
						id="analytics-to"
						type="date"
						className="w-full sm:w-40"
						value={resolved.to}
						min={resolved.from}
						onChange={(event) => onChange({ to: event.target.value, offset: undefined })}
					/>
				</div>
			</div>

			<div className="grid gap-1">
				<span className="text-xs font-medium">Group by</span>
				<ToggleGroup
					type="single"
					value={search.granularity ?? "day"}
					aria-label="Group by"
					onValueChange={(value) => {
						if (!value) return
						onChange({ granularity: value as AnalyticsSearch["granularity"] })
					}}
				>
					<ToggleGroupItem value="day">Day</ToggleGroupItem>
					<ToggleGroupItem value="week">Week</ToggleGroupItem>
					<ToggleGroupItem value="month">Month</ToggleGroupItem>
				</ToggleGroup>
			</div>

			<p className="ml-auto text-xs text-muted-foreground" aria-live="polite">
				{branchLabel} · {resolved.from} → {resolved.to}
			</p>
		</div>
	)
}
