import type { ResolvedSetting, SettingScope } from "../types"
import { metaFor } from "./meta"

/**
 * A setting is grouped by the prefix before the first dot — the server's own namespace — so no
 * list here can forget a group. The order is fixed rather than alphabetical because the groups
 * a person changes together sit together: money first, then stock and supply, then the rest. A
 * prefix this table has never seen is appended alphabetically, labelled from its own name, so a
 * new namespace on the server renders instead of disappearing.
 */
const GROUP_META: Record<string, { label: string; description: string }> = {
	pricing: {
		label: "Pricing",
		description: "How prices are entered and how far a manager may move one.",
	},
	pos: {
		label: "Point of sale",
		description: "Discount ceilings, PIN rules, sync and receipt text for the till.",
	},
	credit: {
		label: "Credit",
		description: "Credit repayment numbering and the customer credit controls.",
	},
	loyalty: {
		label: "Loyalty",
		description: "Earning, redeeming and expiring points.",
	},
	inventory: {
		label: "Inventory",
		description: "Receipt, transfer and count numbering, tolerances and ABC classes.",
	},
	procurement: {
		label: "Procurement",
		description: "Approval thresholds, lead times and purchase document numbering.",
	},
	supplier: { label: "Suppliers", description: "Supplier numbering." },
	payable: {
		label: "Payables",
		description: "Purchase invoice and supplier payment numbering.",
	},
	tax: {
		label: "Tax",
		description: "The seller identity printed on receipts and sent to GRA.",
	},
	flag: {
		label: "Feature flags",
		description: "Switches that turn a feature off without a deploy.",
	},
	staff: { label: "Staff", description: "Staff ID numbering." },
	receipt: { label: "Receipts", description: "Text printed on a receipt." },
	catalog: { label: "Catalog", description: "Product SKU numbering." },
}

/** Money first; then stock and supply; then tax, flags and the rest. */
const GROUP_ORDER: readonly string[] = [
	"pricing",
	"pos",
	"credit",
	"loyalty",
	"inventory",
	"procurement",
	"supplier",
	"payable",
	"tax",
	"flag",
	"staff",
	"receipt",
	"catalog",
]

export function prefixOf(key: string): string {
	return key.split(".", 1)[0] ?? key
}

export function groupLabel(prefix: string): string {
	const label = GROUP_META[prefix]?.label
	if (label) return label
	const spaced = prefix.replace(/[-_]+/g, " ").trim()
	return spaced === "" ? prefix : spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export function groupDescription(prefix: string): string | null {
	return GROUP_META[prefix]?.description ?? null
}

/**
 * Which row a save targets, and the one place a null branch id can be produced.
 *
 * A branch-scoped key is written to the selected branch — unless the person has explicitly
 * chosen "all branches" on that row. The absence of a selected branch is never treated as that
 * choice: with "all" on the switcher the row is read-only, so a stray save cannot become a
 * global override (P14-D43). The throw is a tripwire, not a user path: the row is disabled
 * before it can call this.
 */
export function saveTargetBranchId(
	setting: ResolvedSetting,
	scope: SettingScope,
	activeBranchId: string | null,
): string | null {
	if (!setting.branchScoped) return null
	if (scope === "all") return null
	if (activeBranchId === null) {
		throw new Error("A branch value needs a selected branch; choose a branch first")
	}
	return activeBranchId
}

export interface SettingGroup {
	prefix: string
	label: string
	description: string | null
	settings: ResolvedSetting[]
}

/**
 * Groups in the fixed order above. A group with no keys is never created, so an empty group
 * cannot render as a heading over nothing.
 *
 * `flag.*` keys are excluded: they have their own section at the top of the page, generated from
 * the shared registry, so they are not listed twice.
 */
export function groupSettings(settings: ResolvedSetting[]): SettingGroup[] {
	const groups = new Map<string, SettingGroup>()

	for (const setting of settings) {
		const prefix = prefixOf(setting.key)
		if (prefix === "flag") continue
		const existing = groups.get(prefix)
		if (existing) {
			existing.settings.push(setting)
			continue
		}
		groups.set(prefix, {
			prefix,
			label: groupLabel(prefix),
			description: groupDescription(prefix),
			settings: [setting],
		})
	}

	const known = GROUP_ORDER.filter((prefix) => groups.has(prefix))
	const unknown = [...groups.keys()].filter((prefix) => !GROUP_ORDER.includes(prefix)).sort()

	return [...known, ...unknown].flatMap((prefix) => {
		const group = groups.get(prefix)
		return group ? [group] : []
	})
}

/**
 * The search box filters on the key, the label and the help text. A key is the most precise
 * thing a person can type, and a person who knows it should not have to remember which group
 * the console put it in.
 */
export function filterSettings(settings: ResolvedSetting[], query: string): ResolvedSetting[] {
	const needle = query.trim().toLowerCase()
	if (needle === "") return settings
	return settings.filter((setting) => {
		const meta = metaFor(setting.key)
		return [setting.key, meta.label, meta.description ?? ""].some((field) =>
			field.toLowerCase().includes(needle),
		)
	})
}
