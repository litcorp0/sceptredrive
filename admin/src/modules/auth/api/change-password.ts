import { apiRequest } from "#/lib/api"

/**
 * The one password fetcher that belongs to the auth domain.
 *
 * The `staff` group in `lib/api.ts` keeps its own copy of `changeOwnPassword` until the staff
 * module lands (Plan 03); this module cannot import `#/lib/api-types`, so the input shape is
 * declared here. Both describe the same `POST /api/me/password` contract.
 */
export interface ChangePasswordInput {
	currentPassword: string
	newPassword: string
}

export function changeOwnPassword(input: ChangePasswordInput) {
	return apiRequest<{ ok: true }>("/api/me/password", { method: "POST", body: input })
}
