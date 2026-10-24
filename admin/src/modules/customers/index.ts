/**
 * `customers` — the shared customer identity, its lifecycle (create, edit, archive, reactivate,
 * anonymize) and the profile that composes credit and loyalty.
 *
 * The two keys keep the pre-Phase-8 roots (`["customers"]`, `["customer"]`) byte for byte, because
 * both lifecycle dialogs invalidate them by prefix and the credit and loyalty posting dialogs
 * invalidate the profile key after a mutation. A renamed root would still typecheck and still
 * render, but nothing would refresh after a save.
 *
 * Money stays integer minor units: the profile formats `balanceMinor` and `limitMinor` through
 * `lib/format` and never recomputes them. The anonymize guard is the server's (zero credit balance,
 * zero points); the dialog only mirrors it.
 *
 * The barrel is the only entry point. Credit and loyalty are reached through their own barrels —
 * `#/modules/credit` and `#/modules/loyalty` — never by path.
 */

export {
	anonymizeCustomer,
	archiveCustomer,
	createCustomer,
	customerDetailOptions,
	customerListOptions,
	reactivateCustomer,
	updateCustomer,
} from "./api/customers"
export { customerKeys } from "./api/keys"
export type {
	CustomerCreateInput,
	CustomerCreditProfileRow,
	CustomerDetail,
	CustomerListQuery,
	CustomerListRow,
	CustomerSearchResult,
	CustomerStatus,
	CustomerUpdateInput,
} from "./types"
