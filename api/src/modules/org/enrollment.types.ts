import type { z } from 'zod'
import type { terminalEnrollment } from './enrollment.schema.ts'
import type {
  enrollmentTerminalIdParamSchema,
  redeemEnrollmentSchema,
} from './enrollment.validation.ts'

export type TerminalEnrollmentRow = typeof terminalEnrollment.$inferSelect

export type EnrollmentTerminalIdParams = z.infer<typeof enrollmentTerminalIdParamSchema>
export type RedeemEnrollmentBody = z.infer<typeof redeemEnrollmentSchema>

export interface CreatedEnrollment {
  code: string
  expiresAt: Date
}

export interface RedeemedEnrollment {
  enrollmentId: string
  terminalId: string
}
