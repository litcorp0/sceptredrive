import { validateJson, validateParam } from '../../http/validation.ts'
import { enrollmentTerminalIdParamSchema, redeemEnrollmentSchema } from './enrollment.schema.ts'

export const validateEnrollmentTerminalIdParam = validateParam(enrollmentTerminalIdParamSchema)
export const validateRedeemEnrollmentBody = validateJson(redeemEnrollmentSchema)
