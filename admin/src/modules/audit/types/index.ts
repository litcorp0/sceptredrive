export interface AuditEntry {
	id: string
	actorId: string | null
	actorStaffId: string | null
	action: string
	entity: string
	entityId: string | null
	before: unknown
	after: unknown
	branchId: string | null
	terminalId: string | null
	ip: string | null
	userAgent: string | null
	requestId: string | null
	createdAt: string
}

export type AuditListQuery = {
	actorId?: string
	actorStaffId?: string
	action?: string
	entity?: string
	entityId?: string
	branchId?: string
	from?: string
	to?: string
	limit?: number
	offset?: number
}

export interface AuditListResult {
	entries: AuditEntry[]
	total: number
}
