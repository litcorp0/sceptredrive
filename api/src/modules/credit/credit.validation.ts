import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'

export const CHARGE_REASON_CODES = ['SALE', 'OPENING_BALANCE', 'CORRECTION', 'OTHER'] as const
export const REFUND_REASON_CODES = ['RETURN'] as const
export const ADJUSTMENT_REASON_CODES = ['CORRECTION', 'WRITE_OFF', 'DISPUTE', 'OTHER'] as const
export const ALL_ENTRY_REASON_CODES = [
  'SALE',
  'OPENING_BALANCE',
  'CORRECTION',
  'WRITE_OFF',
  'DISPUTE',
  'RETURN',
  'OTHER',
] as const
export const CREDIT_METHODS = ['CASH', 'MOMO', 'BANK'] as const
export const OVERRIDE_REASON_CODES = [
  'TEMPORARY_APPROVAL',
  'TRUSTED_CUSTOMER',
  'URGENT_NEED',
  'OTHER',
] as const

export const creditProfileParamSchema = z.object({ customerId: z.uuid() })

const notesSchema = z.string().trim().max(300)
const idempotencyKeySchema = z.string().trim().min(8).max(120)

/** Profile settings only — balance is never settable from the outside. */
export const profileUpdateSchema = z
  .object({
    branchId: z.uuid().optional(),
    limitMinor: z.number().int().min(0).optional(),
    hold: z.boolean().optional(),
    paymentTermDays: z.number().int().min(0).max(365).optional(),
    notes: notesSchema.nullish(),
  })
  .strict()
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'At least one field must be provided',
  })

export const profileListQuerySchema = z
  .object({
    customerId: z.uuid().optional(),
    branchId: z.uuid().optional(),
  })
  .refine((value) => value.customerId !== undefined || value.branchId !== undefined, {
    message: 'Provide customerId or branchId',
  })

/**
 * Repayments are entered as positive amounts ("customer paid GHS 60") and
 * stored negative in the ledger; the transform keeps the service signed-only.
 */
export const repaymentCreateSchema = z
  .object({
    customerId: z.uuid(),
    branchId: z.uuid().optional(),
    amountMinor: z.number().int().min(1),
    method: z.enum(CREDIT_METHODS),
    note: notesSchema.optional(),
    occurredAt: z.coerce.date().optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict()
  .transform((value) => ({ ...value, amountMinor: -value.amountMinor }))

/**
 * CHARGE amounts are positive, REFUND amounts positive (stored negative),
 * ADJUSTMENT amounts signed non-zero. Reason codes are kind-specific.
 */
export const entryCreateSchema = z
  .object({
    customerId: z.uuid(),
    branchId: z.uuid().optional(),
    kind: z.enum(['CHARGE', 'REFUND', 'ADJUSTMENT']),
    amountMinor: z.number().int(),
    reasonCode: z.enum(ALL_ENTRY_REASON_CODES).optional(),
    note: notesSchema.optional(),
    occurredAt: z.coerce.date().optional(),
    dueDate: z.coerce.date().optional(),
    referenceType: z.string().trim().max(60).optional(),
    referenceId: z.uuid().optional(),
    referenceNumber: z.string().trim().max(60).optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
    override: z
      .object({ reasonCode: z.enum(OVERRIDE_REASON_CODES), note: notesSchema.optional() })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'CHARGE') {
      if (value.amountMinor < 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['amountMinor'],
          message: 'A charge must be a positive amount',
        })
      }
      if (
        value.reasonCode === undefined ||
        !CHARGE_REASON_CODES.includes(value.reasonCode as (typeof CHARGE_REASON_CODES)[number])
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['reasonCode'],
          message: 'Charges require a reason: SALE, OPENING_BALANCE, CORRECTION, or OTHER',
        })
      }
    }
    if (value.kind === 'REFUND' && value.amountMinor < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['amountMinor'],
        message: 'A refund must be a positive amount',
      })
    }
    if (value.kind === 'ADJUSTMENT') {
      if (value.amountMinor === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['amountMinor'],
          message: 'An adjustment must not be zero',
        })
      }
      if (
        value.reasonCode === undefined ||
        !ADJUSTMENT_REASON_CODES.includes(
          value.reasonCode as (typeof ADJUSTMENT_REASON_CODES)[number],
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['reasonCode'],
          message: 'Adjustments require a reason: CORRECTION, WRITE_OFF, DISPUTE, or OTHER',
        })
      }
    }
  })
  .transform((value) =>
    value.kind === 'REFUND' ? { ...value, amountMinor: -Math.abs(value.amountMinor) } : value,
  )

export const entryListQuerySchema = z.object({
  customerId: z.uuid(),
  branchId: z.uuid().optional(),
  kind: z.enum(['CHARGE', 'REPAYMENT', 'REFUND', 'ADJUSTMENT']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
})

export const agingQuerySchema = z.object({
  branchId: z.uuid().optional(),
  asOf: z.coerce.date().optional(),
})

export const statementParamSchema = z.object({ customerId: z.uuid() })

export const statementQuerySchema = z.object({
  branchId: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

export const validateCreditProfileParam = validateParam(creditProfileParamSchema)
export const validateProfileUpdate = validateJson(profileUpdateSchema)
export const validateProfileListQuery = validateQuery(profileListQuerySchema)
export const validateRepaymentCreate = validateJson(repaymentCreateSchema)
export const validateEntryCreate = validateJson(entryCreateSchema)
export const validateEntryListQuery = validateQuery(entryListQuerySchema)
export const validateAgingQuery = validateQuery(agingQuerySchema)
export const validateStatementParam = validateParam(statementParamSchema)
export const validateStatementQuery = validateQuery(statementQuerySchema)
