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
import { Textarea } from "#/components/ui/textarea"
import { formatGhs, formatMinorPlain, parseGhsToMinor } from "#/lib/format"
import type { ResolvedSetting, SettingControl, SettingMeta, SettingScope } from "../types"
import { sourceLabel, valueNote, writableBySentence } from "../utils/meta"

/** The draft a text-like control starts from. `String(null)` would render "null". */
function draftOf(setting: ResolvedSetting, control: SettingControl): string {
	if (control === "money") {
		return typeof setting.value === "number" ? formatMinorPlain(setting.value) : ""
	}
	return setting.value === null || setting.value === undefined ? "" : String(setting.value)
}

/**
 * One setting row. Presentational by contract: it owns the draft value, the parse and the write
 * scope, and hands a typed value to `onSave`. The page owns the mutation, so no fetch happens
 * here.
 *
 * A branch-scoped key is written to the selected branch. "All branches" is a switch an admin has
 * to turn on for that row — never the state of the branch switcher — and while it is on the save
 * button says what it will do (P14-D43). A manager is not offered the choice, because the API
 * writes their own branch whatever the client asks for.
 *
 * A key with no metadata still renders: the label is the key, the control is plain text, and the
 * page never has to know it exists.
 */
export function SettingRow({
	setting,
	meta,
	control,
	canWrite,
	canSetGlobally,
	reason,
	pending,
	onSave,
}: {
	setting: ResolvedSetting
	meta: SettingMeta
	control: SettingControl
	canWrite: boolean
	/** Only an admin may write the global row, so only an admin is offered the choice. */
	canSetGlobally: boolean
	/** Why the control is disabled. Never shown while `canWrite`. */
	reason: string | null
	pending: boolean
	onSave: (value: unknown, scope: SettingScope) => void
}) {
	const inputId = useId()
	const descriptionId = useId()
	const scopeId = useId()
	const scopeHelpId = useId()
	const [draft, setDraft] = useState(() => draftOf(setting, control))
	const [scope, setScope] = useState<SettingScope>("branch")
	const [error, setError] = useState<string | null>(null)

	// A refetch (another tab, a branch switch) replaces the effective value; the draft and the
	// scope choice follow it rather than keeping a stale edit on screen.
	useEffect(() => {
		setDraft(draftOf(setting, control))
		setScope("branch")
		setError(null)
	}, [setting, control])

	const dirty = draft !== draftOf(setting, control)
	const note = valueNote(setting.key, setting.value)
	const parsedDraft = control === "money" ? parseGhsToMinor(draft) : null
	const chooseScope = setting.branchScoped && canWrite && canSetGlobally
	const describedBy = [
		meta.description ? descriptionId : null,
		note ? `${descriptionId}-note` : null,
	].filter(Boolean)

	function parse(raw: string): { ok: true; value: unknown } | { ok: false; message: string } {
		if (control === "money") {
			const minor = parseGhsToMinor(raw)
			if (minor === null) {
				return { ok: false, message: "Enter an amount in cedis, e.g. 10000.00." }
			}
			return { ok: true, value: minor }
		}
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
		onSave(parsed.value, scope)
	}

	return (
		<form
			onSubmit={handleSubmit}
			data-setting-key={setting.key}
			className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start"
		>
			<div className="min-w-0">
				<div className="flex flex-wrap items-center gap-2">
					<label htmlFor={inputId} className="text-sm font-medium">
						{meta.label}
					</label>
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

			<div
				className={
					control === "textarea"
						? "flex flex-col items-stretch gap-2 md:items-end"
						: "flex flex-wrap items-center gap-2 md:justify-end"
				}
			>
				{control === "boolean" ? (
					<>
						<Switch
							id={inputId}
							checked={setting.value === true}
							disabled={!canWrite || pending}
							aria-describedby={describedBy.join(" ") || undefined}
							onCheckedChange={(checked) => onSave(checked, scope)}
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
						<SelectTrigger
							id={inputId}
							className="h-8 w-44"
							aria-describedby={describedBy.join(" ") || undefined}
						>
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
				) : control === "textarea" ? (
					<Textarea
						id={inputId}
						rows={4}
						className="min-h-28 w-full md:w-[28rem]"
						value={draft}
						disabled={!canWrite || pending}
						aria-describedby={describedBy.join(" ") || undefined}
						onChange={(event) => setDraft(event.target.value)}
					/>
				) : (
					<Input
						id={inputId}
						type={control === "number" ? "number" : "text"}
						step={control === "number" ? "any" : undefined}
						inputMode={control === "number" || control === "money" ? "decimal" : undefined}
						placeholder={control === "money" ? "10000.00" : undefined}
						className={
							control === "number" || control === "money"
								? "h-8 w-40"
								: setting.key.startsWith("web.")
									? "h-8 w-full md:w-80"
									: "h-8 w-40"
						}
						value={draft}
						disabled={!canWrite || pending}
						aria-describedby={describedBy.join(" ") || undefined}
						onChange={(event) => setDraft(event.target.value)}
					/>
				)}
				{control === "boolean" ? null : (
					<Button
						type="submit"
						size="sm"
						className={control === "textarea" ? "self-end" : undefined}
						disabled={!canWrite || !dirty || pending}
					>
						{pending ? "Saving…" : scope === "all" ? "Set for every branch" : "Save"}
					</Button>
				)}
			</div>

			{control === "money" ? (
				<p className="text-xs text-muted-foreground md:col-span-2 md:text-right">
					{parsedDraft === null
						? "Enter an amount in cedis, e.g. 10000.00."
						: `= ${formatGhs(parsedDraft)} (${parsedDraft.toLocaleString("en-GH")} pesewas)`}
				</p>
			) : null}

			{chooseScope ? (
				<div className="flex items-start gap-2 md:col-span-2 md:justify-end">
					<Switch
						id={scopeId}
						size="sm"
						checked={scope === "all"}
						disabled={pending}
						aria-describedby={scopeHelpId}
						onCheckedChange={(checked) => setScope(checked ? "all" : "branch")}
					/>
					<div className="grid gap-0.5">
						<label htmlFor={scopeId} className="text-xs text-muted-foreground">
							All branches
						</label>
						<p id={scopeHelpId} className="text-xs text-muted-foreground">
							{scope === "all"
								? "Writes the global value every branch inherits unless it has its own."
								: "Applies to this branch only."}
						</p>
					</div>
				</div>
			) : null}

			{error ? (
				<p role="alert" className="text-xs text-destructive md:col-span-2">
					{error}
				</p>
			) : null}
		</form>
	)
}
