import type { Role } from "@sceptre/shared"

/** A console staff account. Never carries a password hash or a PIN. */
export interface Staff {
	id: string
	name: string
	email: string
	role: Role
	branchId: string | null
	staffId: string | null
	phone: string | null
	isActive: boolean
	mustChangePassword: boolean
	pinVersion: number
	pinMustChange: boolean
	createdAt: string
	updatedAt: string
}

/** PIN metadata from `/api/staff/:id/pin-status`; never includes the hash. */
export interface StaffPinStatus {
	hasPin: boolean
	pinVersion: number
	pinMustChange: boolean
	activeBindings: number
}

export interface CreateStaffResult {
	staff: Staff
	temporaryPassword: string
	temporaryPin: string | null
	invitationSent: boolean
}

export interface ResetPinResult {
	staffId: string
	pinVersion: number
	temporaryPin: string
	invitationSent: boolean
}

export interface ResetPasswordResult {
	temporaryPassword: string
	invitationSent: boolean
}

export interface StaffCreateInput {
	email: string
	name: string
	role: Role
	branchId?: string | null
	phone?: string
}

export interface StaffUpdateInput {
	name?: string
	phone?: string
	role?: Role
	branchId?: string | null
}

export type StaffListQuery = {
	role?: Role
	branchId?: string
	includeInactive?: boolean
	search?: string
	limit?: number
	offset?: number
}
