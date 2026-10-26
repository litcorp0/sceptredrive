import { APPROVAL_REASON_CODES, APPROVAL_STATUSES, APPROVAL_TYPES } from '@sceptre/shared'
import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'

const limitSchema = z.coerce.number().int().min(1).max(200).default(50)
const offsetSchema = z.coerce.number().int().min(0).default(0)

export const approvalListQuerySchema = z.object({
  type: z.enum(APPROVAL_TYPES).optional(),
  status: z.enum(APPROVAL_STATUSES).optional(),
  branchId: z.uuid().optional(),
  /** One document's request, for a screen that already knows what it is showing. */
  entityId: z.uuid().optional(),
  /** The inbox is a queue: oldest first unless the caller asks otherwise. */
  sort: z.enum(['oldest', 'newest']).default('oldest'),
  limit: limitSchema,
  offset: offsetSchema,
})

export const approvalSummaryQuerySchema = z.object({
  branchId: z.uuid().optional(),
})

export const approvalIdParamSchema = z.object({ id: z.uuid() })

export const approvalDecisionSchema = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    /** Required when rejecting; the service enforces it so a message can name why. */
    reasonCode: z.enum(APPROVAL_REASON_CODES).optional(),
    note: z.string().trim().min(1).max(300).optional(),
  })
  .strict()

export const validateApprovalListQuery = validateQuery(approvalListQuerySchema)
export const validateApprovalSummaryQuery = validateQuery(approvalSummaryQuerySchema)
export const validateApprovalIdParam = validateParam(approvalIdParamSchema)
export const validateApprovalDecision = validateJson(approvalDecisionSchema)
