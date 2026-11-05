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
  /** Who was emailed, and who could not be reached (P20-D5). */
  notification: EnrollmentNotification
}

/**
 * What happened when the code was emailed to the branch's managers.
 *
 * `noRecipients` is its own flag rather than "sent is empty": a branch with no
 * manager means the code has to be handed over by hand, and that is a different
 * instruction from "the mail server was down".
 */
export interface EnrollmentNotification {
  sent: string[]
  failed: string[]
  noRecipients: boolean
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
