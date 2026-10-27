import type { ResolvedSetting } from "../types"

/**
 * A setting is grouped by the prefix before the first dot — the server's own namespace — so no
 * list here can forget a group. The labels are words; an unknown prefix is humanised rather
 * than dropped.
 */
const PREFIX_LABELS: Record<string, string> = {
	auth: "Access",
	staff: "Staff",
	receipt: "Receipts",
	catalog: "Catalog",
	pricing: "Pricing",
	inventory: "Inventory",
	supplier: "Suppliers",
	payable: "Payables",
	procurement: "Procurement",
	pos: "Point of sale",
	credit: "Credit",
	loyalty: "Loyalty",
	tax: "Tax",
	flag: "Feature flags",
}

export function prefixOf(key: string): string {
	return key.split(".", 1)[0] ?? key
}

export function groupLabel(prefix: string): string {
	const label = PREFIX_LABELS[prefix]
	if (label) return label
	const spaced = prefix.replace(/[-_]+/g, " ").trim()
	return spaced === "" ? prefix : spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export interface SettingGroup {
	prefix: string
	label: string
	settings: ResolvedSetting[]
}

/**
 * Groups in the order the API returned the keys. The fixed display order and group
 * descriptions arrive with `groupSettings` in the next step; this one only makes the list
 * navigable, which is what "collect every key" needs. A group with no keys is never created.
 */
export function groupSettings(settings: ResolvedSetting[]): SettingGroup[] {
	const groups = new Map<string, SettingGroup>()

	for (const setting of settings) {
		const prefix = prefixOf(setting.key)
		const existing = groups.get(prefix)
		if (existing) {
			existing.settings.push(setting)
			continue
		}
		groups.set(prefix, { prefix, label: groupLabel(prefix), settings: [setting] })
	}

	return [...groups.values()]
}
