import { PIN_PROBLEM_MESSAGES, pinProblem } from '@gikautos/shared'
import { z } from 'zod'
import { validateJson } from '../../http/validation.ts'

/**
 * Device-facing staff authorization.
 *
 * `staffCode` and `email` are selectors only; a terminal never receives a staff
 * list. At least one is required, and the PIN is bounded before it reaches
 * Argon2 so a hostile body cannot force unbounded work.
 */
export const authorizeStaffSchema = z
  .object({
    staffCode: z.string().trim().min(1).max(64).optional(),
    email: z.email().max(254).optional(),
    pin: z.string().max(16),
  })
  .strict()
  .refine((value) => Boolean(value.staffCode ?? value.email), {
    message: 'A staff code or email is required',
  })

export const changePinSchema = z
  .object({
    currentPin: z.string().max(16),
    newPin: z
      .string()
      .max(16)
      .superRefine((pin, ctx) => {
        const problem = pinProblem(pin)
        if (problem) ctx.addIssue({ code: 'custom', message: PIN_PROBLEM_MESSAGES[problem] })
      }),
  })
  .strict()

export const validateAuthorizeStaff = validateJson(authorizeStaffSchema)
export const validateChangePin = validateJson(changePinSchema)

export type AuthorizeStaffBody = z.infer<typeof authorizeStaffSchema>
export type ChangePinBody = z.infer<typeof changePinSchema>
