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

/**
 * Returned once, at redemption. `deviceToken` is the only copy of the terminal
 * credential the client will ever see; the server keeps a keyed hash.
 */
export interface RedeemedDevice {
  deviceId: string
  deviceToken: string
  terminalId: string
  terminalCode: string
  branchId: string
  branchName: string
  branchCode: string
}
