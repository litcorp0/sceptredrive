import { z } from 'zod'

export const enrollmentTerminalIdParamSchema = z.object({ id: z.uuid() })

export const redeemEnrollmentSchema = z
  .object({
    code: z.string().trim().min(4).max(32),
  })
  .strict()
