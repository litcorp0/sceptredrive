import type { ResolvedSetting, SettingControl, SettingMeta, SettingMetaMap } from "../types"

/**
 * Presentation hints, not a key registry.
 *
 * Every entry names a label and a sentence of help for a key the API returns today. A key that
 * is not here still renders: `metaFor` falls back to the key itself and `controlFor` to a plain
 * text input, so a new server setting can be ugly on the day it lands but never invisible.
 */
export const SETTING_META: SettingMetaMap = {
	// --- Feature flags --------------------------------------------------------
	"flag.supplierTransfers": {
		label: "Supplier transfers",
		description: "Pay suppliers with a Paystack transfer instead of a manual payment.",
	},
	"flag.evatSubmission": {
		label: "E-VAT submission",
		description: "Submit invoices and refunds to GRA for an E-VAT certificate.",
	},
	"flag.posConflictResolution": {
		label: "POS conflict resolution",
		description: "Show the POS conflict queue and let managers resolve conflicts.",
	},

	// --- Staff and receipts ------------------------------------------------
	"staff.idPrefix": {
		label: "Staff ID prefix",
		description: "Prefix for staff IDs, e.g. GA-0001. 1–8 letters or digits.",
	},
	"staff.idSequence": {
		label: "Next staff number",
		description: "The next number to allocate. Changing this affects new accounts only.",
	},
	"receipt.header": {
		label: "Receipt header",
		description: "Printed at the top of every receipt. Can differ per branch.",
	},

	// --- Loyalty --------------------------------------------------------------
	"loyalty.earnPointsPerCedi": {
		label: "Points earned per GHS 1",
		description: "Whole points earned per cedi spent (calculated with a floor per sale).",
	},
	"loyalty.pointsPerCedi": {
		label: "Points per GHS 1 discount",
		description: "How many points are worth GHS 1 when redeemed.",
	},
	"loyalty.expiryMonths": {
		label: "Points expiry (months)",
		description: "Points expire after this many months.",
	},
	"loyalty.minimumRedeemPoints": {
		label: "Minimum redemption (points)",
		description: "The smallest redemption accepted at the till and in the console.",
	},

	// --- Credit ---------------------------------------------------------------
	"credit.defaultLimitMinor": {
		label: "Default credit limit (GH₵)",
		control: "money",
		description:
			"Every customer registered at this branch starts with this line. 0 means no credit until someone sets a limit. Administrators only: a manager who could raise it would bypass the approval on a limit increase.",
	},
	"credit.repaymentPrefix": {
		label: "Repayment receipt prefix",
		description: "Prefix for credit repayment receipts, e.g. REP-00001. 1–8 letters or digits.",
	},
	"credit.repaymentSequence": {
		label: "Next repayment number",
		description: "The next repayment number to allocate. Changing this affects new receipts only.",
	},

	// --- Catalog and pricing --------------------------------------------------
	"catalog.skuPrefix": {
		label: "SKU prefix",
		description: "Prefix for auto-generated product SKUs, e.g. GIK-00001. 1–8 letters or digits.",
	},
	"catalog.skuSequence": {
		label: "Next SKU number",
		description: "The next number for new products. Saving a suggested SKU advances it.",
	},
	"pricing.vatRegistered": {
		label: "The business is VAT-registered",
		description:
			"Off means no VAT, NHIL or GETFund on any line, whatever the catalogue says — use it until the business is registered (or if it never is). On charges the 20% stack on standard-rated products. This is not the GRA reporting switch.",
	},
	"pricing.taxMode": {
		label: "Tax mode",
		description:
			"Inclusive: entered prices already contain VAT, NHIL, and GETFund. Exclusive: tax is added on top.",
		control: "select",
		options: [
			{ value: "INCLUSIVE", label: "Tax-inclusive prices" },
			{ value: "EXCLUSIVE", label: "Tax-exclusive prices" },
		],
	},
	"pricing.managerBandPercent": {
		label: "Manager price band (%)",
		description:
			"How far a manager may move a price without an approval. Administrators only: a branch that sets its own band has none.",
	},

	// --- Inventory ------------------------------------------------------------
	"inventory.defaultLowStockThreshold": {
		label: "Default low-stock threshold",
		description:
			"Units at or below this are low stock when a product has no threshold of its own. 0 means only an empty shelf counts. A product's own threshold always wins.",
	},
	"pos.outOfStockPolicy": {
		label: "Selling an out-of-stock item",
		description:
			"Block: a manager PIN is needed to add it. Warn: the cashier may sell anyway after a confirmation. Allow: add it with no prompt. The sale always records the stock conflict.",
		control: "select",
		options: [
			{ value: "BLOCK", label: "Block (manager override)" },
			{ value: "WARN", label: "Warn, then allow" },
			{ value: "ALLOW", label: "Allow silently" },
		],
	},
	"inventory.receiptPrefix": {
		label: "Goods receipt prefix",
		description: "Prefix for goods receipt numbers, e.g. GRN-00001. 1–8 letters or digits.",
	},
	"inventory.receiptSequence": {
		label: "Next goods receipt number",
		description:
			"The next goods receipt number to allocate. It advances only when a receipt is posted; gaps are acceptable.",
	},
	"inventory.transferPrefix": {
		label: "Transfer prefix",
		description: "Prefix for stock transfer numbers, e.g. TRF-00001. 1–8 letters or digits.",
	},
	"inventory.transferSequence": {
		label: "Next transfer number",
		description:
			"The next stock transfer number to allocate. It advances only when a transfer is dispatched; gaps are acceptable.",
	},
	"inventory.countPrefix": {
		label: "Stock count prefix",
		description: "Prefix for stock count numbers, e.g. CNT-00001. 1–8 letters or digits.",
	},
	"inventory.countSequence": {
		label: "Next stock count number",
		description:
			"The next stock count number to allocate. It advances only when a count is recorded; gaps are acceptable.",
	},
	"inventory.countVarianceToleranceMinor": {
		label: "Count variance tolerance (GH₵)",
		control: "money",
		description:
			"A posted count whose absolute variance value is larger than this raises a trigger count. Enter cedis; stored as integer pesewas.",
	},
	"inventory.writeOffPrefix": {
		label: "Write-off serial prefix",
		description: "Prefix for branch-month write-off serials, e.g. WO-ACC-202610-0001.",
	},
	"inventory.abcAThresholdBp": {
		label: "ABC class A share (basis points)",
		description:
			"Cumulative score share at which a product becomes class A. Must stay below the class B share.",
	},
	"inventory.abcBThresholdBp": {
		label: "ABC class B share (basis points)",
		description:
			"Cumulative score share at which a product becomes class B. Must stay above the class A share.",
	},

	// --- Procurement ----------------------------------------------------------
	"procurement.approvalThresholdMinor": {
		label: "Purchase approval threshold (GH₵)",
		control: "money",
		description:
			"At or above this goods value an admin must decide a purchase order. Enter cedis; stored as integer pesewas. Administrators only: a branch that can raise its own limit has no limit.",
	},
	"procurement.safetyDays": {
		label: "Safety days of cover",
		description: "Extra days added to the supplier lead time when suggesting an order.",
	},
	"procurement.defaultLeadDays": {
		label: "Assumed lead time (days)",
		description: "Used when the supplier–product link carries no lead time of its own.",
	},
	"procurement.orderPrefix": {
		label: "Purchase order prefix",
		description: "Prefix for purchase order numbers, e.g. PO-00001. 1–8 letters or digits.",
	},
	"procurement.returnPrefix": {
		label: "Purchase return prefix",
		description: "Prefix for purchase return numbers, e.g. PR-00001. 1–8 letters or digits.",
	},
	"procurement.creditNotePrefix": {
		label: "Supplier credit note prefix",
		description: "Prefix for supplier credit note numbers, e.g. SCN-00001. 1–8 letters or digits.",
	},

	// --- Suppliers and payables ----------------------------------------------
	"supplier.codePrefix": {
		label: "Supplier code prefix",
		description: "Prefix for supplier codes, e.g. SUP-00001. 1–8 letters or digits.",
	},
	"supplier.codeSequence": {
		label: "Next supplier number",
		description:
			"The next supplier number to allocate. It advances only when a supplier is created; gaps are acceptable.",
	},
	"payable.invoicePrefix": {
		label: "Purchase invoice prefix",
		description: "Prefix for purchase invoice numbers, e.g. SINV-00001. 1–8 letters or digits.",
	},
	"payable.invoiceSequence": {
		label: "Next purchase invoice number",
		description:
			"The next purchase invoice number to allocate. It advances only when an invoice is recorded; gaps are acceptable.",
	},
	"payable.paymentPrefix": {
		label: "Supplier payment prefix",
		description: "Prefix for supplier payment numbers, e.g. PAY-00001. 1–8 letters or digits.",
	},
	"payable.paymentSequence": {
		label: "Next supplier payment number",
		description:
			"The next supplier payment number to allocate. It advances only when a payment is recorded; gaps are acceptable.",
	},

	// --- Point of sale --------------------------------------------------------
	"pos.maxCashierDiscountPercent": {
		label: "Cashier discount ceiling (%)",
		description: "The largest discount a cashier may apply without a manager override.",
	},
	"pos.maxManagerDiscountPercent": {
		label: "Manager discount ceiling (%)",
		description: "The largest discount a manager may apply at the till.",
	},
	"pos.pinMaxAttempts": {
		label: "PIN attempts before lockout",
		description: "Failed PIN entries tolerated on a terminal before it locks the cashier out.",
	},
	"pos.pinLockMinutes": {
		label: "PIN lockout (minutes)",
		description: "How long a locked cashier waits before a supervisor can clear the lock.",
	},
	"pos.clockSkewToleranceMinutes": {
		label: "Clock tolerance (minutes)",
		description:
			"An upload whose terminal clock is further from the server's is refused as suspicious.",
	},
	"pos.syncBatchSize": {
		label: "Sync batch size",
		description: "Rows per upload batch. Lower it on a weak connection.",
	},
	"pos.receiptFooter": {
		label: "Receipt footer",
		description: "Printed below the totals on every receipt.",
	},
	"pos.salesRequireOpenShift": {
		label: "Sales need an open shift",
		description:
			"Refuse a sale when the terminal has no open shift. Turning this off lets the till sell without a drawer.",
	},
	"pos.shiftVarianceToleranceMinor": {
		label: "Shift variance tolerance (GH₵)",
		control: "money",
		description:
			"A close whose absolute variance is larger than this raises a review. Enter cedis; stored as integer pesewas. Administrators only: a branch that sets its own tolerance has none.",
	},
	"pos.refundApprovalThresholdMinor": {
		label: "Refund approval threshold (GH₵)",
		control: "money",
		description:
			"At or above this gross refund an admin must decide it. Enter cedis; stored as integer pesewas. Administrators only: a branch that sets its own cap has none.",
	},

	// --- Tax and seller identity ---------------------------------------------
	"tax.sellerTin": {
		label: "Seller TIN",
		description:
			"Printed on receipts and sent to GRA when present. Leave blank until GRA onboarding assigns it.",
	},
	"tax.sellerVatNumber": {
		label: "Seller VAT number",
		description: "Printed on receipts and sent to GRA when present.",
	},

	// --- Website --------------------------------------------------------------
	"web.siteName": {
		label: "Site name",
		description: "The business name in the site header, footer and page titles.",
	},
	"web.tagline": {
		label: "Tagline",
		description: "One line under the name in the header and the social preview.",
	},
	"web.heroHeading": {
		label: "Home headline",
		description: "The largest line on the home page. Keep it short.",
	},
	"web.heroBody": {
		label: "Home introduction",
		control: "textarea",
		description: "The paragraph under the home headline.",
	},
	"web.aboutBody": {
		label: "About the business",
		control: "textarea",
		description: "The story on the About page. Plain text; paragraphs are preserved.",
	},
	"web.announcement": {
		label: "Announcement bar",
		description: "Shown above the header on every page. Leave blank to hide it.",
	},
	"web.shopStatus": {
		label: "Online shop",
		control: "select",
		options: [
			{ value: "COMING_SOON", label: "Coming soon" },
			{ value: "OPEN", label: "Open" },
		],
		description: "What the Shop page says. There is no checkout in this phase.",
	},
	"web.contactEmail": {
		label: "Contact email",
		description: "Shown on the contact page and in the footer. Leave blank to hide the action.",
	},
	"web.contactPhone": {
		label: "Contact phone",
		description:
			"The number the site dials. Include the country code. Blank hides the call action.",
	},
	"web.whatsapp": {
		label: "WhatsApp number",
		description:
			"A number customers can message about a part. Include the country code. Blank hides the action.",
	},
	"web.instagram": {
		label: "Instagram URL",
		description: "An https:// profile link. Blank hides the icon.",
	},
	"web.facebook": {
		label: "Facebook URL",
		description: "An https:// profile link. Blank hides the icon.",
	},
	"web.tiktok": {
		label: "TikTok URL",
		description: "An https:// profile link. Blank hides the icon.",
	},
	"web.branchHours": {
		label: "Opening hours (this branch)",
		description:
			"Set per branch, e.g. Mon–Sat, 8:00–18:00. Blank hides the hours line for that branch.",
	},
	"web.branchMapUrl": {
		label: "Map link (this branch)",
		description: "An https:// maps link. Blank builds a map search from the branch address.",
	},
}

/** A key with no hint is still a key: its own name is the label. */
export function metaFor(key: string): SettingMeta {
	return SETTING_META[key] ?? { label: key }
}

/**
 * How a value is edited. The hint wins when the value's type is not the control (an enum of
 * strings is rendered as a select); otherwise the value's own type decides, and an unknown key
 * is a plain text control.
 */
export function controlFor(setting: ResolvedSetting, meta: SettingMeta): SettingControl {
	if (meta.control) return meta.control
	if (typeof setting.value === "boolean") return "boolean"
	if (typeof setting.value === "number") return "number"
	return "text"
}

export function sourceLabel(source: ResolvedSetting["source"]): string {
	return source === "branch" ? "Branch" : source === "global" ? "Global" : "Default"
}

/** Who may write the key, in words rather than a role name. */
export function writableBySentence(writableBy: ResolvedSetting["writableBy"]): string {
	return writableBy === "admin"
		? "Administrators only"
		: "Branch managers may change this for their own branch"
}

/**
 * A display note for values whose stored unit is not the unit a person reads. Money stays in
 * integer pesewas everywhere; this only *formats* it, it never converts or recomputes it.
 */
export function valueNote(key: string, value: unknown): string | null {
	if (typeof value !== "number") return null
	if (key.endsWith("Minor")) {
		return `Stored as ${value.toLocaleString("en-GH")} pesewas. Enter cedis; the equivalent is shown below.`
	}
	if (key.endsWith("Bp")) return "Basis points: 1 bp = 0.01%."
	if (key.endsWith("Percent")) return "Whole percent, 0–100."
	return null
}
