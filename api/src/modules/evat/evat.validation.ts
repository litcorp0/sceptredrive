import { EVAT_DOCUMENT_KINDS, EVAT_SUBMISSION_STATUSES } from '@sceptre/shared'
import { z } from 'zod'
import { validateParam, validateQuery } from '../../http/validation.ts'

const limitSchema = z.coerce.number().int().min(1).max(200).default(50)
const offsetSchema = z.coerce.number().int().min(0).default(0)

/**
 * The list filters (P14-D40). `overdue` is a query-time derivation, so it is a
 * string enum here and a boolean in the repository: a query parameter has no
 * types, and `overdue=false` must mean "on time", not "absent".
 *
 * `from`/`to` range the document's deadline — `occurred_at + 24h`, the closest
 * stored proxy for when the document happened, since an offline sale is queued
 * hours after it was taken.
 */
export const evatListQuerySchema = z
  .object({
    branchId: z.uuid().optional(),
    status: z.enum(EVAT_SUBMISSION_STATUSES).optional(),
    kind: z.enum(EVAT_DOCUMENT_KINDS).optional(),
    overdue: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    limit: limitSchema,
    offset: offsetSchema,
  })
  // Strict: a misspelt filter is a 400, not a silently unfiltered page. An
  // operator who asked for one branch must never be shown every branch.
  .strict()

export const evatIdParamSchema = z.object({ id: z.uuid() })

export const validateEvatListQuery = validateQuery(evatListQuerySchema)
export const validateEvatIdParam = validateParam(evatIdParamSchema)
