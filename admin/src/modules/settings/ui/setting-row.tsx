import { type FormEvent, useEffect, useId, useState } from "react"
import { StatusBadge } from "#/components/common/status-badge"
import { Button } from "#/components/ui/button"
import { Input } from "#/components/ui/input"
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "#/components/ui/select"
import { Switch } from "#/components/ui/switch"
import type { ResolvedSetting, SettingControl, SettingMeta } from "../types"
import { sourceLabel, valueNote, writableBySentence } from "../utils/meta"

/** The draft a text-like control starts from. `String(null)` would render "null". */
function draftOf(setting: ResolvedSetting): string {
	return setting.value === null || setting.value === undefined ? "" : String(setting.value)
}

/**
 * One setting row. Presentational by contract: it owns the draft value and the parse, and hands
 * a typed value to `onSave`. The page owns the mutation, so no fetch happens here.
 *
 * A key with no metadata still renders: the label is the key, the control is plain text, and the
 * page never has to know it exists.
 */
export function SettingRow({
	setting,
	meta,
	control,
	canWrite,
	reason,
	pending,
	onSave,
}: {
	setting: ResolvedSetting
	meta: SettingMeta
	control: SettingControl
	canWrite: boolean
	/** Why the control is disabled. Never shown while `canWrite`. */
	reason: string | null
	pending: boolean
	onSave: (value: unknown) => void
}) {
	const inputId = useId()
	const descriptionId = useId()
	const [draft, setDraft] = useState(() => draftOf(setting))
	const [error, setError] = useState<string | null>(null)

	// A refetch (another tab, a branch switch) replaces the effective value; the draft follows it
	// rather than keeping a stale edit on screen.
	useEffect(() => {
		setDraft(draftOf(setting))
		setError(null)
	}, [setting])

	const dirty = draft !== draftOf(setting)
	const note = valueNote(setting.key, setting.value)
	const describedBy = [
		meta.description ? descriptionId : null,
		note ? `${descriptionId}-note` : null,
	]
		.filter(Boolean)
		.join(" ")

	function parse(raw: string): { ok: true; value: unknown } | { ok: false; message: string } {
		if (control !== "number") return { ok: true, value: raw }
		const trimmed = raw.trim()
		if (trimmed === "") return { ok: false, message: "Enter a number." }
		const parsed = Number(trimmed)
		if (!Number.isFinite(parsed)) return { ok: false, message: "Enter a valid number." }
		return { ok: true, value: parsed }
	}

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (!dirty) return
		const parsed = parse(draft)
		if (!parsed.ok) {
			setError(parsed.message)
			return
		}
		setError(null)
		onSave(parsed.value)
	}

	const label = (
		<label htmlFor={inputId} className="text-sm font-medium">
			{meta.label}
		</label>
	)

	return (
		<form
			onSubmit={handleSubmit}
			data-setting-key={setting.key}
			className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
		>
			<div className="min-w-0">
				<div className="flex flex-wrap items-center gap-2">
					{label}
					<StatusBadge variant={setting.source === "branch" ? "info" : "muted"}>
						{sourceLabel(setting.source)}
					</StatusBadge>
				</div>
				<p className="mt-0.5 font-mono text-[11px] text-muted-foreground">{setting.key}</p>
				{meta.description ? (
					<p id={descriptionId} className="mt-1 text-xs text-muted-foreground">
						{meta.description}
					</p>
				) : null}
				{note ? (
					<p id={`${descriptionId}-note`} className="mt-1 text-xs text-muted-foreground">
						{note}
					</p>
				) : null}
				<p className="mt-1 text-xs text-muted-foreground">
					{canWrite || !reason ? writableBySentence(setting.writableBy) : reason}
				</p>
			</div>

			<div className="flex flex-wrap items-center gap-2 md:justify-end">
				{control === "boolean" ? (
					<>
						<Switch
							id={inputId}
							checked={setting.value === true}
							disabled={!canWrite || pending}
							aria-describedby={describedBy || undefined}
							onCheckedChange={(checked) => onSave(checked)}
						/>
						<span className="text-xs text-muted-foreground">
							{setting.value === true ? "On" : "Off"}
						</span>
					</>
				) : control === "select" ? (
					<Select
						value={draft}
						onValueChange={(next) => setDraft(next)}
						disabled={!canWrite || pending}
					>
						<SelectTrigger id={inputId} className="h-8 w-44" aria-describedby={describedBy}>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{(meta.options ?? []).map((option) => (
								<SelectItem key={option.value} value={option.value}>
									{option.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				) : (
					<Input
						id={inputId}
						type={control === "number" ? "number" : "text"}
						step={control === "number" ? "any" : undefined}
						inputMode={control === "number" ? "decimal" : undefined}
						className="h-8 w-40"
						value={draft}
						disabled={!canWrite || pending}
						aria-describedby={describedBy || undefined}
						onChange={(event) => setDraft(event.target.value)}
					/>
				)}
				{control === "boolean" ? null : (
					<Button type="submit" size="sm" disabled={!canWrite || !dirty || pending}>
						{pending ? "Saving…" : "Save"}
					</Button>
				)}
			</div>

			{error ? (
				<p role="alert" className="text-xs text-destructive md:col-span-2">
					{error}
				</p>
			) : null}
		</form>
	)
}
