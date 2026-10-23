import { PIN_PROBLEM_MESSAGES, pinProblem } from '@gikautos/shared'
import { z } from 'zod'
import { validateJson, validateQuery } from '../../http/validation.ts'

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

// --- Upload (Plan 05) -------------------------------------------------------

const minorUnits = z.number().int().min(0)
const overrideProofSchema = z
  .object({
    staffId: z.string().trim().min(1).max(64),
    userId: z.string().trim().min(1).max(64),
    bindingId: z.uuid(),
    pinVersion: z.number().int().min(0),
    reasonCode: z.string().trim().min(1).max(32),
    note: z.string().max(200).nullish(),
    occurredAt: z.iso.datetime(),
  })
  .strict()

const saleLineSchema = z
  .object({
    productId: z.uuid(),
    quantity: z.number().int().min(1).max(1_000_000),
    unitPriceMinor: minorUnits,
    lineDiscountMinor: minorUnits,
    taxCategory: z.enum(['STANDARD', 'ZERO_RATED', 'EXEMPT']),
  })
  .strict()

const saleTotalsSchema = z
  .object({
    subtotalMinor: minorUnits,
    lineDiscountMinor: minorUnits,
    saleDiscountMinor: minorUnits,
    loyaltyDiscountMinor: minorUnits,
    vatMinor: minorUnits,
    nhilMinor: minorUnits,
    getfundMinor: minorUnits,
    taxTotalMinor: minorUnits,
    totalMinor: minorUnits,
    changeMinor: minorUnits,
  })
  .strict()

const salePayloadSchema = z
  .object({
    receiptNumber: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9-]+$/),
    shiftId: z.uuid(),
    cashier: z
      .object({
        userId: z.string().trim().min(1).max(64),
        staffId: z.string().trim().min(1).max(64),
        bindingId: z.uuid(),
        bindingToken: z
          .string()
          .min(20)
          .max(128)
          .regex(/^[A-Za-z0-9_-]+$/),
        pinVersion: z.number().int().min(0),
      })
      .strict(),
    customer: z
      .object({
        id: z.uuid(),
        phone: z.string().trim().min(3).max(32),
        name: z.string().trim().min(1).max(120).optional(),
      })
      .strict()
      .nullish(),
    lines: z.array(saleLineSchema).min(1).max(200),
    saleDiscount: z
      .object({
        amountMinor: minorUnits,
        reasonCode: z.enum(['STAFF', 'DAMAGE', 'PROMO', 'OTHER']),
        note: z.string().max(200).nullish(),
        override: overrideProofSchema.nullish(),
      })
      .strict()
      .nullish(),
    loyalty: z
      .object({
        redeemPoints: z.number().int().min(0),
        earnPreviewPoints: z.number().int().min(0),
      })
      .strict()
      .nullish(),
    tenders: z
      .array(
        z
          .object({
            method: z.enum(['CASH', 'CREDIT']),
            amountMinor: minorUnits,
            override: overrideProofSchema.nullish(),
          })
          .strict(),
      )
      .max(2),
    totals: saleTotalsSchema,
    occurredAt: z.iso.datetime(),
    appVersion: z.string().max(40).nullish(),
  })
  .strict()

const shiftOpenPayloadSchema = z
  .object({
    shiftId: z.uuid(),
    number: z.string().trim().min(1).max(64),
    openingFloatMinor: minorUnits,
    cashierUserId: z.string().trim().min(1).max(64),
    cashierStaffId: z.string().trim().min(1).max(64),
    occurredAt: z.iso.datetime(),
  })
  .strict()

const cashMovementPayloadSchema = z
  .object({
    id: z.uuid(),
    shiftId: z.uuid(),
    type: z.enum(['CASH_IN', 'CASH_OUT']),
    amountMinor: z.number().int().min(1),
    reason: z.string().trim().min(1).max(120),
    occurredAt: z.iso.datetime(),
    staffUserId: z.string().trim().min(1).max(64),
    staffStaffId: z.string().trim().min(1).max(64),
  })
  .strict()

const shiftClosePayloadSchema = z
  .object({
    shiftId: z.uuid(),
    countedCashMinor: minorUnits,
    clientExpectedCashMinor: minorUnits,
    closeNote: z.string().max(200).nullish(),
    occurredAt: z.iso.datetime(),
  })
  .strict()

const transactionBase = {
  clientTransactionId: z.uuid(),
  occurredAt: z.iso.datetime(),
  payloadVersion: z.literal(1),
}

export const uploadTransactionSchema = z.discriminatedUnion('type', [
  z.object({ ...transactionBase, type: z.literal('SALE'), payload: salePayloadSchema }).strict(),
  z
    .object({ ...transactionBase, type: z.literal('SHIFT_OPEN'), payload: shiftOpenPayloadSchema })
    .strict(),
  z
    .object({
      ...transactionBase,
      type: z.literal('CASH_MOVEMENT'),
      payload: cashMovementPayloadSchema,
    })
    .strict(),
  z
    .object({
      ...transactionBase,
      type: z.literal('SHIFT_CLOSE'),
      payload: shiftClosePayloadSchema,
    })
    .strict(),
])

export const uploadSchema = z
  .object({
    batchId: z.uuid(),
    deviceId: z.uuid(),
    terminalId: z.uuid(),
    transactions: z.array(uploadTransactionSchema).min(1).max(50),
  })
  .strict()

export const conflictsQuerySchema = z.object({
  since: z.iso.datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export const validateUpload = validateJson(uploadSchema)
export const validateConflictsQuery = validateQuery(conflictsQuerySchema)

export type UploadBody = z.infer<typeof uploadSchema>
export type UploadTransactionBody = z.infer<typeof uploadTransactionSchema>
export type ConflictsQuery = z.infer<typeof conflictsQuerySchema>
