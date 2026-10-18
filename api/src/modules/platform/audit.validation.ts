import { z } from 'zod'
import { validateQuery } from '../../http/validation.ts'

export const auditListQuerySchema = z.object({
  actorId: z.string().trim().min(1).max(64).optional(),
  actorStaffId: z.string().trim().min(1).max(64).optional(),
  action: z.string().trim().min(1).max(120).optional(),
  entity: z.string().trim().min(1).max(64).optional(),
  entityId: z.string().trim().min(1).max(64).optional(),
  branchId: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
})

export const validateAuditListQuery = validateQuery(auditListQuerySchema)
