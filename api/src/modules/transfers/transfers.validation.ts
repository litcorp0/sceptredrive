import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'

const limitSchema = z.coerce.number().int().min(1).max(200).default(50)
const offsetSchema = z.coerce.number().int().min(0).default(0)

const transferLineSchema = z
  .object({
    productId: z.uuid(),
    quantityRequested: z.number().int().min(1).max(1_000_000),
  })
  .strict()

const transferLinesRefine = {
  message: 'Each product may appear only once',
} as const

export const transferCreateSchema = z
  .object({
    fromBranchId: z.uuid(),
    toBranchId: z.uuid(),
    note: z.string().trim().min(1).max(300).optional(),
    lines: z.array(transferLineSchema).min(1).max(100),
  })
  .strict()
  .refine(
    (value) => new Set(value.lines.map((line) => line.productId)).size === value.lines.length,
    transferLinesRefine,
  )

export const transferUpdateSchema = z
  .object({
    note: z.string().trim().max(300).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required',
  })

export const transferLinesReplaceSchema = z
  .object({ lines: z.array(transferLineSchema).min(1).max(100) })
  .strict()
  .refine(
    (value) => new Set(value.lines.map((line) => line.productId)).size === value.lines.length,
    transferLinesRefine,
  )

const dispatchLineSchema = z
  .object({
    productId: z.uuid(),
    quantityDispatched: z.number().int().min(0).max(1_000_000),
  })
  .strict()

export const dispatchSchema = z
  .object({ lines: z.array(dispatchLineSchema).min(1).max(100) })
  .strict()
  .refine(
    (value) => new Set(value.lines.map((line) => line.productId)).size === value.lines.length,
    transferLinesRefine,
  )

const receiveLineSchema = z
  .object({
    productId: z.uuid(),
    quantityReceived: z.number().int().min(0).max(1_000_000),
  })
  .strict()

export const receiveSchema = z
  .object({ lines: z.array(receiveLineSchema).min(1).max(100) })
  .strict()
  .refine(
    (value) => new Set(value.lines.map((line) => line.productId)).size === value.lines.length,
    transferLinesRefine,
  )

export const shortCloseSchema = z.object({ note: z.string().trim().min(1).max(300) }).strict()

export const transferListQuerySchema = z.object({
  branchId: z.uuid().optional(),
  // Phase 12's request states are filterable like the rest: the source branch's
  // queue is `status=REQUESTED`, and the console must not have to fetch a page
  // of every transfer to find it.
  status: z
    .enum([
      'DRAFT',
      'REQUESTED',
      'APPROVED',
      'REJECTED',
      'DISPATCHED',
      'RECEIVED',
      'SHORT_CLOSED',
      'CANCELLED',
    ])
    .optional(),
  direction: z.enum(['from', 'to']).optional(),
  limit: limitSchema,
  offset: offsetSchema,
})

export const transferIdParamSchema = z.object({ id: z.uuid() })

export const validateTransferCreate = validateJson(transferCreateSchema)
export const validateTransferUpdate = validateJson(transferUpdateSchema)
export const validateTransferLinesReplace = validateJson(transferLinesReplaceSchema)
export const validateDispatch = validateJson(dispatchSchema)
export const validateReceive = validateJson(receiveSchema)
export const validateShortClose = validateJson(shortCloseSchema)
export const validateTransferListQuery = validateQuery(transferListQuerySchema)
export const validateTransferIdParam = validateParam(transferIdParamSchema)
