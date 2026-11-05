import { FLAG_DEFAULTS, FLAG_KEYS, type FlagKey } from "@sceptre/shared"
import { useQuery } from "@tanstack/react-query"
import { type ResolvedSetting, settingsListOptions } from "#/modules/settings"

/**
 * Feature flags, resolved against the settings the console already loads.
 *
 * A flag is a typed setting; a key with no row resolves to its registry default (P14-D41).
 * Shared by the sidebar and the section layouts, so a tab and the rail cannot disagree about
 * whether a feature is on.
 */
export function flagValues(settings: ResolvedSetting[] | undefined): Record<FlagKey, boolean> {
	const values: Record<FlagKey, boolean> = { ...FLAG_DEFAULTS }
	for (const key of FLAG_KEYS) {
		const row = settings?.find((setting) => setting.key === key)
		if (typeof row?.value === "boolean") values[key] = row.value
	}
	return values
}

/** The same map, from one query. `enabled` is false for a role that cannot read settings. */
export function useFlagValues(enabled = true): Record<FlagKey, boolean> {
	const { data } = useQuery({ ...settingsListOptions(), enabled })
	return flagValues(data?.settings)
}
