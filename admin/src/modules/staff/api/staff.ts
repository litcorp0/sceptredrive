import { queryOptions } from "@tanstack/react-query"
import { apiRequest } from "#/lib/api"
import type {
	CreateStaffResult,
	ResetPasswordResult,
	ResetPinResult,
	Staff,
	StaffCreateInput,
	StaffListQuery,
	StaffPinStatus,
	StaffUpdateInput,
} from "../types"
import { staffKeys } from "./keys"

/** `GET /api/staff` — already branch-scoped server-side for a manager. */
export function staffListOptions(query: StaffListQuery = {}) {
	return queryOptions({
		queryKey: staffKeys.list(query),
		queryFn: () => apiRequest<{ staff: Staff[]; total: number }>("/api/staff", { query }),
	})
}

export function staffDetailOptions(id: string) {
	return queryOptions({
		queryKey: [...staffKeys.all, { id }] as const,
		queryFn: () => apiRequest<{ staff: Staff }>(`/api/staff/${id}`),
	})
}

export function createStaff(input: StaffCreateInput) {
	return apiRequest<CreateStaffResult>("/api/staff", { method: "POST", body: input })
}

export function updateStaff(id: string, input: StaffUpdateInput) {
	return apiRequest<{ staff: Staff }>(`/api/staff/${id}`, { method: "PATCH", body: input })
}

export function resetStaffPassword(id: string) {
	return apiRequest<ResetPasswordResult>(`/api/staff/${id}/reset-password`, { method: "POST" })
}

export function staffPinStatus(id: string) {
	return apiRequest<StaffPinStatus>(`/api/staff/${id}/pin-status`)
}

export function resetStaffPin(id: string) {
	return apiRequest<ResetPinResult>(`/api/staff/${id}/pin/reset`, { method: "POST" })
}

export function deactivateStaff(id: string) {
	return apiRequest<{ staff: Staff }>(`/api/staff/${id}/deactivate`, { method: "POST" })
}

export function reactivateStaff(id: string) {
	return apiRequest<{ staff: Staff }>(`/api/staff/${id}/reactivate`, { method: "POST" })
}
