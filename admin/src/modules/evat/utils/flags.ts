import { FLAG_DEFAULTS, type FlagKey } from "@sceptre/shared"
import type { ResolvedSetting } from "#/modules/settings"

/**
 * A flag is a typed setting (P14-D41); a missing row means its registry default, not "off".
 * Queueing also checks this server-side, so the notice is an explanation, not the control.
 */
export function readFlag(settings: ResolvedSetting[] | undefined, key: FlagKey): boolean {
	const row = settings?.find((setting) => setting.key === key)
	return typeof row?.value === "boolean" ? row.value : FLAG_DEFAULTS[key]
}
