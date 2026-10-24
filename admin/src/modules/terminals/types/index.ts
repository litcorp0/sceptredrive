export type DeviceStatus = "ACTIVE" | "REVOKED"

export interface Terminal {
	id: string
	branchId: string
	code: string
	name: string
	isActive: boolean
	lastSeenAt: string | null
	createdBy: string | null
	createdAt: string
	updatedAt: string
}

export interface Device {
	id: string
	terminalId: string
	fingerprint: string
	status: DeviceStatus
	enrolledAt: string
	revokedAt: string | null
	lastSeenAt: string | null
}

/** A one-time enrollment code for a terminal. */
export interface Enrollment {
	code: string
	expiresAt: string
}

export interface TerminalCreateInput {
	branchId: string
	name: string
}

export interface TerminalUpdateInput {
	name?: string
	isActive?: boolean
}

export type TerminalListQuery = {
	branchId?: string
	includeInactive?: boolean
}
