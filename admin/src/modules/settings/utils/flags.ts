import {
	FLAG_DEFAULTS,
	FLAG_DESCRIPTIONS,
	FLAG_KEYS,
	type FlagKey,
	isFlagKey,
} from "@sceptre/shared"
import type { ResolvedSetting } from "../types"
import { metaFor } from "./meta"

export interface FlagRow {
	key: FlagKey
	setting: ResolvedSetting
}

/**
 * One row per registry flag, in `FLAG_KEYS` order.
 *
 * A flag the API did not return is still rendered, as its registry default with `default` as its
 * source: the registry is the contract, and a flag missing from the response is a flag an
 * operator needs to see, not one to hide. Toggling it writes the row.
 */
export function flagRows(settings: ResolvedSetting[]): FlagRow[] {
	return FLAG_KEYS.map((key) => {
		const resolved = settings.find((setting) => setting.key === key)
		return {
			key,
			setting: resolved ?? {
				key,
				value: FLAG_DEFAULTS[key],
				branchScoped: false,
				writableBy: "admin",
				source: "default",
			},
		}
	})
}

/** The search box filters flags on the same three fields the settings rows use. */
export function filterFlags(rows: FlagRow[], query: string): FlagRow[] {
	const needle = query.trim().toLowerCase()
	if (needle === "") return rows
	return rows.filter((row) => {
		const meta = metaFor(row.key)
		return [row.key, meta.label, FLAG_DESCRIPTIONS[row.key]].some((field) =>
			field.toLowerCase().includes(needle),
		)
	})
}

export { isFlagKey }
