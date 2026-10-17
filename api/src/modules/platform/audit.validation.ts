import { validateQuery } from '../../http/validation.ts'
import { auditListQuerySchema } from './audit.schema.ts'

export const validateAuditListQuery = validateQuery(auditListQuerySchema)
