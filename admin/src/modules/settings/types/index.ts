export type SettingKey =
	| "auth.requireTwoFactor"
	| "staff.idPrefix"
	| "staff.idSequence"
	| "receipt.header"
	| "loyalty.earnPointsPerCedi"
	| "loyalty.pointsPerCedi"
	| "loyalty.expiryMonths"
	| "loyalty.minimumRedeemPoints"
	| "credit.repaymentPrefix"
	| "credit.repaymentSequence"
	| "catalog.skuPrefix"
	| "catalog.skuSequence"
	| "pricing.taxMode"
	| "supplier.codePrefix"
	| "supplier.codeSequence"
	| "payable.invoicePrefix"
	| "payable.invoiceSequence"
	| "payable.paymentPrefix"
	| "payable.paymentSequence"

export interface ResolvedSetting {
	key: SettingKey
	value: unknown
	branchScoped: boolean
	source: "branch" | "global" | "default"
}

export interface SettingsUpdateInput {
	key: string
	value: unknown
	branchId?: string | null
}

/** How a setting is rendered and parsed. `text`/`select` stay strings, `switch` is boolean. */
export interface SettingMeta {
	key: SettingKey
	group: string
	label: string
	description: string
	type: "text" | "int" | "decimal" | "select" | "switch"
	options?: Array<{ value: string; label: string }>
}
