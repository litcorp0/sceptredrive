import { FLAG_DESCRIPTIONS, type FlagKey } from "@sceptre/shared"
import { useId } from "react"
import { StatusBadge } from "#/components/common/status-badge"
import { Switch } from "#/components/ui/switch"
import type { ResolvedSetting } from "../types"
import type { FlagRow } from "../utils/flags"
import { metaFor, sourceLabel, writableBySentence } from "../utils/meta"
import { groupDescription, groupLabel } from "../utils/settings"

/**
 * The three feature flags, as switches.
 *
 * A flag is a typed setting (P14-D41), so each change is exactly one `PATCH /api/settings` and
 * the settings path writes the `setting.updated` audit row with the before and after. There is
 * no flag endpoint and no second store: the switch the operator flips and the record in the
 * audit log are the same write.
 *
 * A flag whose server row is absent renders its registry default with `Default` as its source;
 * toggling it writes the row. A caller who may not write sees the switch disabled and the reason,
 * because the value must stay readable.
 */
export function FlagSwitches({
	rows,
	canWrite,
	reason,
	pendingKey,
	onChange,
}: {
	rows: FlagRow[]
	canWrite: boolean
	/** Why the switches are disabled. Never shown while `canWrite`. */
	reason: string | null
	pendingKey: string | null
	onChange: (key: FlagKey, next: boolean) => void
}) {
	const headingId = useId()
	const descriptionId = useId()

	if (rows.length === 0) return null

	return (
		<section aria-labelledby={headingId} aria-describedby={descriptionId}>
			<h2 id={headingId} className="text-sm font-medium text-muted-foreground">
				{groupLabel("flag")}
			</h2>
			<p id={descriptionId} className="mb-2 text-xs text-muted-foreground">
				{groupDescription("flag")} Each change writes one setting, so the audit log records who
				turned it off and when.
			</p>
			<div className="divide-y rounded-lg border bg-card">
				{rows.map((row) => (
					<FlagSwitchRow
						key={row.key}
						row={row}
						canWrite={canWrite}
						reason={reason}
						pending={pendingKey === row.key}
						onChange={onChange}
					/>
				))}
			</div>
		</section>
	)
}

function FlagSwitchRow({
	row,
	canWrite,
	reason,
	pending,
	onChange,
}: {
	row: FlagRow
	canWrite: boolean
	reason: string | null
	pending: boolean
	onChange: (key: FlagKey, next: boolean) => void
}) {
	const inputId = useId()
	const descriptionId = useId()
	const setting: ResolvedSetting = row.setting
	const title = metaFor(row.key).label
	const description = FLAG_DESCRIPTIONS[row.key]

	return (
		<div
			data-setting-key={row.key}
			className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
		>
			<div className="min-w-0">
				<div className="flex flex-wrap items-center gap-2">
					<label htmlFor={inputId} className="text-sm font-medium">
						{title}
					</label>
					<StatusBadge variant={setting.source === "branch" ? "info" : "muted"}>
						{sourceLabel(setting.source)}
					</StatusBadge>
				</div>
				<p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{row.key}</p>
				<p id={descriptionId} className="mt-1 text-xs text-muted-foreground">
					{description}
				</p>
				<p className="mt-1 text-xs text-muted-foreground">
					{canWrite || !reason ? writableBySentence(setting.writableBy) : reason}
				</p>
			</div>
			<div className="flex items-center gap-2 md:justify-end">
				<Switch
					id={inputId}
					checked={setting.value === true}
					disabled={!canWrite || pending}
					aria-describedby={descriptionId}
					onCheckedChange={(checked) => onChange(row.key, checked)}
				/>
				<span className="w-6 text-xs text-muted-foreground">
					{setting.value === true ? "On" : "Off"}
				</span>
			</div>
		</div>
	)
}
