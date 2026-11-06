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

/**
 * One typed boolean setting, with the registry default when no row exists.
 *
 * Same rule as a flag: absence is not "off", it is "whatever the default says". Used by the
 * navigation, which must not offer a page the business cannot use (P20-D14).
 */
export function booleanSetting(
	settings: ResolvedSetting[] | undefined,
	key: string,
): boolean | null {
	const row = settings?.find((setting) => setting.key === key)
	return typeof row?.value === "boolean" ? row.value : null
}

/** Whether the business is VAT-registered — the switch the E-VAT page depends on. */
export function useVatRegistered(enabled = true): boolean {
	const { data } = useQuery({ ...settingsListOptions(), enabled })
	// The registry default is `true`: a deployment that never wrote the setting still
	// collects tax, so the link stays visible until someone turns it off.
	return booleanSetting(data?.settings, "pricing.vatRegistered") ?? true
}
