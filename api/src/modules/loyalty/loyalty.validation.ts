import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'

export const LOYALTY_ADJUST_REASON_CODES = ['CORRECTION', 'GOODWILL', 'OTHER'] as const
export const LOYALTY_ENTRY_REASON_CODES = [
  'EXPIRY',
  'RETURN',
  'CORRECTION',
  'GOODWILL',
  'OTHER',
] as const

const notesSchema = z.string().trim().max(300)
const idempotencyKeySchema = z.string().trim().min(8).max(120)

export const loyaltyAccountParamSchema = z.object({ customerId: z.uuid() })

/**
 * Staff postings. REDEEM/CLAWBACK points are entered positive ("customer uses
 * 400 points") and stored negative; ADJUST points are signed. EARN carries the
 * net amount paid and the engine computes the points from the current rate.
 */
export const loyaltyEntryCreateSchema = z
  .object({
    customerId: z.uuid(),
    branchId: z.uuid().optional(),
    kind: z.enum(['EARN', 'REDEEM', 'CLAWBACK', 'ADJUST']),
    netPaidMinor: z.number().int().min(1).optional(),
    points: z.number().int().optional(),
    reasonCode: z.enum(LOYALTY_ENTRY_REASON_CODES).optional(),
    note: notesSchema.optional(),
    occurredAt: z.coerce.date().optional(),
    referenceType: z.string().trim().max(60).optional(),
    referenceId: z.uuid().optional(),
    referenceNumber: z.string().trim().max(60).optional(),
    idempotencyKey: idempotencyKeySchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === 'EARN') {
      if (value.netPaidMinor === undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['netPaidMinor'],
          message: 'EARN requires the net amount paid in minor units',
        })
      }
      if (value.points !== undefined) {
        ctx.addIssue({
          code: 'custom',
          path: ['points'],
          message: 'EARN points are computed from the amount paid',
        })
      }
      return
    }

    if (value.netPaidMinor !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['netPaidMinor'],
        message: 'Only EARN takes the amount paid',
      })
    }

    if (value.kind === 'REDEEM' || value.kind === 'CLAWBACK') {
      if (value.points === undefined || value.points < 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['points'],
          message: 'A positive whole number of points is required',
        })
      }
    }

    if (
      value.kind === 'CLAWBACK' &&
      value.reasonCode !== undefined &&
      value.reasonCode !== 'RETURN'
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['reasonCode'],
        message: 'A clawback is always reason RETURN',
      })
    }

    if (value.kind === 'ADJUST') {
      if (value.points === undefined || value.points === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['points'],
          message: 'A non-zero whole number of points is required',
        })
      }
      if (
        value.reasonCode === undefined ||
        !LOYALTY_ADJUST_REASON_CODES.includes(
          value.reasonCode as (typeof LOYALTY_ADJUST_REASON_CODES)[number],
        )
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['reasonCode'],
          message: 'Adjustments require a reason: CORRECTION, GOODWILL, or OTHER',
        })
      }
    }
  })
  .transform((value) => {
    const { points, ...rest } = value
    const pointsDelta =
      value.kind === 'EARN'
        ? undefined
        : value.kind === 'ADJUST'
          ? (points as number)
          : -(points as number)
    return {
      ...rest,
      pointsDelta,
      reasonCode: value.kind === 'CLAWBACK' ? ('RETURN' as const) : (value.reasonCode ?? null),
    }
  })

export const liabilityQuerySchema = z.object({
  branchId: z.uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
})

export const validateLoyaltyAccountParam = validateParam(loyaltyAccountParamSchema)
export const validateLoyaltyEntryCreate = validateJson(loyaltyEntryCreateSchema)
export const validateLiabilityQuery = validateQuery(liabilityQuerySchema)
