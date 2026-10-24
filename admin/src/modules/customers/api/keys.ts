import type { CustomerListQuery } from "../types"

/**
 * Every key the customers module owns.
 *
 * The roots are measured, not guessed: `["customers"]` for the list — which is also the only
 * search, by phone suffix or by name — and `["customer"]` for the profile. They are two roots on
 * purpose: `["customer"]` is not a prefix of `["customers"]`, so a lifecycle mutation invalidates
 * both explicitly. No third customer key exists in the console today.
 *
 * `byId` is the one key another module invalidates: a credit or loyalty posting on the profile
 * must refresh the customer read, and those dialogs name this factory instead of rebuilding the
 * literal. `SHELL_KEYS` in `#/lib/query-keys.ts` is the precedent for a root shared across the
 * shell; this one is shared between two modules that already depend on the customers barrel.
 */
export const customerKeys = {
	all: ["customers"] as const,
	detail: ["customer"] as const,

	list: (query: CustomerListQuery) => [...customerKeys.all, query] as const,
	byId: (customerId: string) => [...customerKeys.detail, customerId] as const,
}
