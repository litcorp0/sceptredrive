import type { z } from 'zod'
import type { auditLog } from './audit.schema.ts'
import type { auditListQuerySchema } from './audit.validation.ts'

export type AuditLogRow = typeof auditLog.$inferSelect

export type AuditListQuery = z.infer<typeof auditListQuerySchema>

export interface AuditActor {
  actorId: string | null
  actorStaffId: string | null
  ip: string | null
  userAgent: string | null
  requestId: string | null
}

export interface AuditEntry {
  action: string
  entity: string
  actorId?: string | null
  actorStaffId?: string | null
  entityId?: string | null
  before?: unknown
  after?: unknown
  branchId?: string | null
  terminalId?: string | null
  ip?: string | null
  userAgent?: string | null
  requestId?: string | null
}

export interface AuditQueryFilters {
  actorId?: string | undefined
  actorStaffId?: string | undefined
  action?: string | undefined
  entity?: string | undefined
  entityId?: string | undefined
  branchId?: string | undefined
  from?: Date | undefined
  to?: Date | undefined
  limit: number
  offset: number
}

export interface AuditQueryResult {
  entries: AuditLogRow[]
  total: number
}
