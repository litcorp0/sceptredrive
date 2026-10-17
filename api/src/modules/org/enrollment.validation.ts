import { z } from 'zod'
import { validateJson, validateParam } from '../../http/validation.ts'

export const enrollmentTerminalIdParamSchema = z.object({ id: z.uuid() })

export const redeemEnrollmentSchema = z
  .object({
    code: z.string().trim().min(4).max(32),
  })
  .strict()

export const validateEnrollmentTerminalIdParam = validateParam(enrollmentTerminalIdParamSchema)
export const validateRedeemEnrollmentBody = validateJson(redeemEnrollmentSchema)
