import {
  CART_VOID_REASONS,
  isElectronicTender,
  MAX_TENDERS_PER_SALE,
  PIN_PROBLEM_MESSAGES,
  pinProblem,
  REFUND_REASONS,
  REFUND_RESTOCK_OPTIONS,
  TENDER_METHODS,
} from '@sceptre/shared'
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

// GHS 10,000,000 per amount: bounded so integer arithmetic cannot overflow.
const minorUnits = z.number().int().min(0).max(1_000_000_000)
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

/**
 * The staff proof a device-originated fact carries: who acted, on which live
 * binding. Declared once so the sale, the refund, the repayment, the void and
 * the shift close cannot drift apart (P13-D41).
 */
const staffProofSchema = z
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
  .strict()

const saleLineSchema = z
  .object({
    productId: z.uuid(),
    quantity: z.number().int().min(1).max(10_000),
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

const tenderSchema = z
  .object({
    method: z.enum(TENDER_METHODS),
    amountMinor: minorUnits,
    /** REQUIRED for MOMO | CARD | BANK_TRANSFER, forbidden otherwise (P13-D6). */
    paymentId: z.uuid().nullish(),
    override: overrideProofSchema.nullish(),
  })
  .strict()
  .superRefine((tender, ctx) => {
    const electronic = isElectronicTender(tender.method)
    if (electronic && !tender.paymentId) {
      ctx.addIssue({ code: 'custom', message: 'An electronic tender needs its paid payment' })
    }
    if (!electronic && tender.paymentId) {
      ctx.addIssue({ code: 'custom', message: 'Cash and credit tenders carry no payment' })
    }
  })

const salePayloadSchema = z
  .object({
    receiptNumber: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9-]+$/),
    shiftId: z.uuid(),
    cashier: staffProofSchema,
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
    // Array order is the receipt order: the server writes `sequence = index + 1`
    // and the payload carries no ordinal that could disagree with it (P13-D1).
    tenders: z.array(tenderSchema).max(MAX_TENDERS_PER_SALE),
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
    // Additive (P13-D41): a till that predates Phase 13 omits it and the close
    // falls back to the shift's cashier, which is what Phase 12 did.
    closedBy: staffProofSchema.nullish(),
    occurredAt: z.iso.datetime(),
  })
  .strict()

const transactionBase = {
  clientTransactionId: z.uuid(),
  occurredAt: z.iso.datetime(),
  payloadVersion: z.literal(1),
}

/**
 * A refund is a document the till numbers offline, so the number is a shape
 * rule here and a uniqueness rule in the database (P13-D37). The D17/D22 rules
 * a client can check alone live in the `superRefine`: `DAMAGED` requires a
 * reason of substance, every other restock forbids one, and the tenders must
 * add up to the money returned. The caps that need the sale live in the
 * service, under a row lock.
 */
const refundLineSchema = z
  .object({
    saleLineId: z.uuid(),
    quantity: z.number().int().min(1).max(10_000),
    restock: z.enum(REFUND_RESTOCK_OPTIONS),
    damageReason: z.string().trim().max(120).nullish(),
  })
  .strict()

const refundTenderSchema = z
  .object({
    saleTenderId: z.uuid(),
    amountMinor: minorUnits,
  })
  .strict()

const refundPayloadSchema = z
  .object({
    saleId: z.uuid(),
    number: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9-]+$/),
    shiftId: z.uuid(),
    cashier: staffProofSchema,
    reasonCode: z.enum(REFUND_REASONS),
    note: z.string().trim().max(300).nullish(),
    approval: overrideProofSchema,
    lines: z.array(refundLineSchema).min(1).max(200),
    tenders: z.array(refundTenderSchema).min(1).max(MAX_TENDERS_PER_SALE),
    refundedMinor: z.number().int().min(1).max(1_000_000_000),
    occurredAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    for (const line of value.lines) {
      if (line.restock === 'DAMAGED') {
        if (!line.damageReason || line.damageReason.length < 3) {
          ctx.addIssue({
            code: 'custom',
            message: 'A damaged line needs a damage reason of at least 3 characters',
            path: ['lines'],
          })
        }
      } else if (line.damageReason) {
        ctx.addIssue({
          code: 'custom',
          message: 'Only a damaged line carries a damage reason',
          path: ['lines'],
        })
      }
    }

    const allocated = value.tenders.reduce((sum, tender) => sum + tender.amountMinor, 0)
    if (allocated !== value.refundedMinor) {
      ctx.addIssue({
        code: 'custom',
        message: 'The tender allocations must add up to the refunded amount',
        path: ['tenders'],
      })
    }
  })

/**
 * A repayment is cash in the drawer or money the provider already settled. The
 * two are not interchangeable: MoMo must cite its paid payment, cash must not,
 * because a payment id on a cash repayment would let the same money be counted
 * twice (P13-D27).
 */
const creditRepaymentPayloadSchema = z
  .object({
    customerId: z.uuid(),
    shiftId: z.uuid(),
    cashier: staffProofSchema,
    amountMinor: z.number().int().min(1).max(1_000_000_000),
    method: z.enum(['CASH', 'MOMO']),
    paymentId: z.uuid().nullish(),
    // The till's own number, printed offline; the ledger keeps it.
    number: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[A-Za-z0-9-]+$/),
    note: z.string().trim().max(200).nullish(),
    override: overrideProofSchema.nullish(),
    occurredAt: z.iso.datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.method === 'MOMO' && !value.paymentId) {
      ctx.addIssue({
        code: 'custom',
        message: 'A MoMo repayment needs the payment it settled',
        path: ['paymentId'],
      })
    }
    if (value.method !== 'MOMO' && value.paymentId) {
      ctx.addIssue({
        code: 'custom',
        message: 'A cash repayment carries no payment',
        path: ['paymentId'],
      })
    }
  })

const cartVoidLineSchema = z
  .object({
    productId: z.uuid(),
    name: z.string().trim().max(200),
    quantity: z.number().int().min(1).max(10_000),
    unitPriceMinor: minorUnits,
  })
  .strict()

/**
 * A cart that never became a sale (P13-D28). No PIN: a void that needed a
 * manager is a void that never gets recorded. `OTHER` needs a note, which the
 * service checks through the shared helper so the till's dialog and the server
 * agree on the sentence.
 */
const cartVoidPayloadSchema = z
  .object({
    shiftId: z.uuid(),
    cashier: staffProofSchema,
    reasonCode: z.enum(CART_VOID_REASONS),
    note: z.string().trim().max(200).nullish(),
    itemCount: z.number().int().min(0).max(10_000),
    grossMinor: minorUnits,
    label: z.string().trim().max(60).nullish(),
    lines: z.array(cartVoidLineSchema).max(200),
    occurredAt: z.iso.datetime(),
  })
  .strict()

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
  z
    .object({ ...transactionBase, type: z.literal('REFUND'), payload: refundPayloadSchema })
    .strict(),
  z
    .object({
      ...transactionBase,
      type: z.literal('CREDIT_REPAYMENT'),
      payload: creditRepaymentPayloadSchema,
    })
    .strict(),
  z
    .object({ ...transactionBase, type: z.literal('CART_VOID'), payload: cartVoidPayloadSchema })
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
export type RefundBody = z.infer<typeof refundPayloadSchema>
export type CreditRepaymentBody = z.infer<typeof creditRepaymentPayloadSchema>
export type CartVoidBody = z.infer<typeof cartVoidPayloadSchema>
export type ConflictsQuery = z.infer<typeof conflictsQuerySchema>
