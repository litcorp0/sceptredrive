import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type { ResolvedSetting, SettingsUpdateInput } from "../types"
import { settingsKeys } from "./keys"

/** `GET /api/settings` — global defaults, overridden per branch when `branchId` is set. */
export function settingsListOptions(query: { branchId?: string } = {}) {
	return queryOptions({
		queryKey: settingsKeys.list(query),
		queryFn: () =>
			apiRequest<{ settings: ResolvedSetting[]; branchId: string | null }>("/api/settings", {
				query,
			}),
	})
}

/** `PATCH /api/settings` — one value, one scope. The API audits and validates it. */
export function settingsUpdate(input: SettingsUpdateInput) {
	return apiRequest<{ setting: ResolvedSetting }>("/api/settings", {
		method: "PATCH",
		body: input,
	})
}
