/**
 * The setting keys belong to the server, not to this console.
 *
 * `GET /api/settings` returns the resolved value for every key in `SETTING_DEFINITIONS` and the
 * page renders the response. A closed union here is what silently dropped 27 of 51 keys
 * (P14-D42), so `SettingKey` is deliberately just `string`: a key added on the server must be
 * visible the day it lands, even before this file has a label for it.
 */
export type SettingKey = string

export interface ResolvedSetting {
	key: SettingKey
	value: unknown
	branchScoped: boolean
	/** `admin` keys are branch-overridable but only an admin may write them. */
	writableBy: "admin" | "manager"
	source: "branch" | "global" | "default"
}

export interface SettingsUpdateInput {
	key: string
	value: unknown
	branchId?: string | null
}

/**
 * The control a row renders. `text` and `select` stay strings, `number` is parsed to a number,
 * `money` is parsed from cedis to integer pesewas, and `boolean` to a boolean. An unknown key is
 * always `text`.
 */
export type SettingControl = "text" | "number" | "boolean" | "select" | "money"

/**
 * Where a write lands. `branch` writes the branch's own row; `all` writes the global row every
 * branch inherits unless it has one. The global write only exists behind an explicit choice
 * (P14-D43).
 */
export type SettingScope = "branch" | "all"

/** Presentation hints only. They describe a row; they never decide whether it exists. */
export interface SettingMeta {
	label: string
	description?: string
	/** Only needed when the value's own type is not the control (an enum of strings). */
	control?: SettingControl
	options?: ReadonlyArray<{ value: string; label: string }>
}

export type SettingMetaMap = Readonly<Record<string, SettingMeta>>
