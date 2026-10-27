import { normalizeGhanaPhone } from '@sceptre/shared'
import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'

/**
 * Transport shapes only. The service re-derives the amount, the shift and the
 * provider reference; the body can never name a branch, a terminal, or a
 * payment status (P13-D6).
 */

const mobileMoneySchema = z
  .object({
    provider: z.enum(['mtn', 'atl', 'vod']),
    phone: z.string().trim().min(9).max(20),
  })
  .strict()

export const createPaymentSchema = z
  .object({
    clientPaymentId: z.uuid(),
    shiftId: z.uuid(),
    method: z.enum(['MOMO', 'CARD', 'BANK_TRANSFER']),
    amountMinor: z.number().int().min(1).max(10_000_000),
    mobileMoney: mobileMoneySchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.method === 'MOMO') {
      if (!value.mobileMoney) {
        ctx.addIssue({
          code: 'custom',
          path: ['mobileMoney'],
          message: 'A mobile money payment needs a provider and a phone',
        })
        return
      }
      if (!normalizeGhanaPhone(value.mobileMoney.phone)) {
        ctx.addIssue({
          code: 'custom',
          path: ['mobileMoney', 'phone'],
          message: 'Enter a valid Ghana mobile number',
        })
      }
      return
    }

    if (value.mobileMoney) {
      ctx.addIssue({
        code: 'custom',
        path: ['mobileMoney'],
        message: 'Only a mobile money payment carries a mobile money provider',
      })
    }
  })

export const paymentQuerySchema = z.object({ refresh: z.enum(['1', '0']).default('0') }).strict()

export const paymentIdParamSchema = z.object({ id: z.uuid() })

export const claimPaymentSchema = z.object({ saleId: z.uuid() }).strict()

export const mockSettleSchema = z
  .object({
    reference: z.string().trim().min(1).max(100),
    outcome: z.enum(['PAID', 'FAILED', 'EXPIRED']),
  })
  .strict()

export const validateCreatePayment = validateJson(createPaymentSchema)
export const validatePaymentQuery = validateQuery(paymentQuerySchema)
export const validatePaymentIdParam = validateParam(paymentIdParamSchema)
export const validateClaimPayment = validateJson(claimPaymentSchema)
export const validateMockSettle = validateJson(mockSettleSchema)
