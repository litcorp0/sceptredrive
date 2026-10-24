import { apiRequest } from "#/lib/api"

/**
 * The one password fetcher that belongs to the auth domain.
 *
 * `POST /api/me/password` changes the signed-in user's own password, so it is auth's contract, not
 * a staff row: the input shape is declared here and `pages/change-password-page` is its only
 * caller.
 */
export interface ChangePasswordInput {
	currentPassword: string
	newPassword: string
}

export function changeOwnPassword(input: ChangePasswordInput) {
	return apiRequest<{ ok: true }>("/api/me/password", { method: "POST", body: input })
}
