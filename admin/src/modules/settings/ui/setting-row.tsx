import { type FormEvent, useEffect, useState } from "react"
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
import type { ResolvedSetting, SettingMeta } from "../types"

/**
 * One setting row. Presentational by contract (D3): it owns the draft value and the dirty check,
 * and hands the raw string to `onSave`. The page owns the mutation, so no fetch happens here.
 */
export function SettingRow({
	meta,
	setting,
	canEdit,
	pending,
	branchScoped,
	globalOnly,
	onSave,
}: {
	meta: SettingMeta
	setting: ResolvedSetting
	canEdit: boolean
	pending: boolean
	branchScoped: boolean
	globalOnly: boolean
	onSave: (value: string) => void
}) {
	const [value, setValue] = useState("")

	useEffect(() => {
		setValue(String(setting.value))
	}, [setting.value])

	const dirty = value !== String(setting.value)

	function handleSubmit(event: FormEvent<HTMLFormElement>) {
		event.preventDefault()
		if (!dirty) return
		onSave(value)
	}

	const sourceLabel =
		setting.source === "branch" ? "Branch" : setting.source === "global" ? "Global" : "Default"

	return (
		<form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3 p-4">
			<div className="min-w-52 flex-1">
				<div className="flex items-center gap-2">
					<p className="text-sm font-medium">{meta.label}</p>
					<StatusBadge tone={setting.source === "branch" ? "blue" : "zinc"}>
						{sourceLabel}
					</StatusBadge>
				</div>
				<p className="mt-0.5 text-xs text-muted-foreground">{meta.description}</p>
			</div>

			<div className="flex items-center gap-2">
				{meta.type === "switch" ? (
					<>
						<Switch
							checked={setting.value === true}
							disabled={!canEdit || pending}
							onCheckedChange={(checked) => {
								setValue(String(checked))
								onSave(String(checked))
							}}
							aria-label={meta.label}
						/>
						<span className="w-6 text-xs text-muted-foreground">
							{setting.value === true ? "On" : "Off"}
						</span>
					</>
				) : meta.type === "select" ? (
					<Select value={value} onValueChange={(next) => setValue(next)} disabled={!canEdit}>
						<SelectTrigger className="h-8 w-44" aria-label={meta.label}>
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
						type={meta.type === "text" ? "text" : "number"}
						step={meta.type === "decimal" ? "any" : undefined}
						className="h-8 w-40"
						value={value}
						disabled={!canEdit}
						onChange={(event) => setValue(event.target.value)}
						aria-label={meta.label}
					/>
				)}
				{meta.type === "switch" ? null : (
					<Button type="submit" size="sm" disabled={!canEdit || !dirty || pending}>
						{pending ? "Saving…" : "Save"}
					</Button>
				)}
			</div>

			{globalOnly ? (
				<p className="w-full text-xs text-amber-600">Only administrators can change this value.</p>
			) : null}
			{branchScoped && !globalOnly && !canEdit && setting.source === "default" ? (
				<p className="w-full text-xs text-muted-foreground">
					Currently using the built-in default.
				</p>
			) : null}
		</form>
	)
}
