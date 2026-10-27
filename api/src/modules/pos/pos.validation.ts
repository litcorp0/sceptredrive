import {
  CONFLICT_RESOLUTION_CODES,
  CONFLICT_TYPE_LABELS,
  REFUND_REASONS,
  resolutionProblem,
  TENDER_METHODS,
} from '@sceptre/shared'
import { z } from 'zod'
import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'

/** Admin reconciliation read; managers are pinned to their own branch. */
export const reconciliationQuerySchema = z.object({
  branchId: z.uuid().optional(),
})

export const validateReconciliationQuery = validateQuery(reconciliationQuerySchema)

export type ReconciliationQuery = z.infer<typeof reconciliationQuerySchema>

// --- Oversight reads (Phase 14, Plan 03) ------------------------------------
//
// Every oversized screen in the console is a paged, filtered read of documents,
// never an aggregate (P14-D2). `.strict()` because a filter a route silently
// ignores is a manager believing they narrowed a list (OWASP A05).

const oversightIdParamSchema = z.object({ id: z.uuid() })
export const validateOversightIdParam = validateParam(oversightIdParamSchema)

const pagingFields = {
  limit: z.coerce.number().int().min(1).max(50).default(20),
  offset: z.coerce.number().int().min(0).default(0),
}

/** An admin may ask for one branch or all; a manager is pinned to theirs. */
const scopeFields = {
  branchId: z.uuid().optional(),
  /** Inclusive Accra days; the service widens `to` to the next midnight. */
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  terminalId: z.uuid().optional(),
}

export const oversightSalesQuerySchema = z
  .object({
    ...scopeFields,
    cashierStaffId: z.string().trim().min(1).max(40).optional(),
    /** Exact and case-sensitive: a receipt number names one document. */
    receiptNumber: z.string().trim().min(1).max(60).optional(),
    ...pagingFields,
  })
  .strict()

export const oversightRefundsQuerySchema = z
  .object({
    ...scopeFields,
    reasonCode: z.enum(REFUND_REASONS).optional(),
    method: z.enum(TENDER_METHODS).optional(),
    tenderStatus: z.enum(['SETTLED', 'PENDING', 'FAILED', 'NEEDS_ATTENTION']).optional(),
    ...pagingFields,
  })
  .strict()

export const oversightShiftsQuerySchema = z
  .object({
    ...scopeFields,
    cashierStaffId: z.string().trim().min(1).max(40).optional(),
    status: z.enum(['OPEN', 'CLOSED']).optional(),
    reviewStatus: z.enum(['NONE', 'REQUIRED', 'REVIEWED']).optional(),
    ...pagingFields,
  })
  .strict()

export const shiftReportQuerySchema = z.object({ kind: z.enum(['X', 'Z']) }).strict()

export const validateOversightSalesQuery = validateQuery(oversightSalesQuerySchema)
export const validateOversightRefundsQuery = validateQuery(oversightRefundsQuerySchema)
export const validateOversightShiftsQuery = validateQuery(oversightShiftsQuerySchema)
export const validateShiftReportQuery = validateQuery(shiftReportQuerySchema)

export type OversightSalesQuery = z.infer<typeof oversightSalesQuerySchema>
export type OversightRefundsQuery = z.infer<typeof oversightRefundsQuerySchema>
export type OversightShiftsQuery = z.infer<typeof oversightShiftsQuerySchema>
export type ShiftReportQuery = z.infer<typeof shiftReportQuerySchema>

// --- The conflict queue (Phase 14, Plan 04) ---------------------------------
//
// Two schemas: the queue's filters and the resolution's body. Both are `.strict()`
// — a filter a route silently ignores is a manager believing they narrowed a list,
// and a body field a route ignores is a resolution that recorded less than the
// client thought it did (OWASP A05).

/**
 * The 16 conflict types, taken from the shared label map so the filter, the
 * console's dropdown and the `sync_conflict_type` enum cannot drift: a type with
 * no label is a type nobody can name.
 */
const conflictTypeNames = Object.keys(CONFLICT_TYPE_LABELS) as [string, ...string[]]

export const conflictListQuerySchema = z
  .object({
    ...scopeFields,
    /** `OPEN` is the queue's default: everything ever is a log, not a queue. */
    status: z.enum(['OPEN', 'RESOLVED', 'DISMISSED', 'ALL']).default('OPEN'),
    type: z.enum(conflictTypeNames).optional(),
    severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
    saleId: z.uuid().optional(),
    shiftId: z.uuid().optional(),
    ...pagingFields,
  })
  .strict()

/**
 * The resolution body. `code` is required by the enum, `note` is required only for
 * a dismissal, and that rule is `resolutionProblem`'s — the same function the
 * console calls, so the two cannot disagree about when the note is needed
 * (P14-D14). A code outside the enum is a 400 before the service is reached.
 */
export const conflictResolutionSchema = z
  .object({
    status: z.enum(['RESOLVED', 'DISMISSED']),
    code: z.enum(CONFLICT_RESOLUTION_CODES),
    note: z.string().trim().max(500).nullish(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const problem = resolutionProblem({
      status: value.status,
      code: value.code,
      note: value.note ?? null,
    })
    if (problem) ctx.addIssue({ code: 'custom', message: problem })
  })

export const validateConflictListQuery = validateQuery(conflictListQuerySchema)
export const validateConflictResolution = validateJson(conflictResolutionSchema)

export type ConflictListQuery = z.infer<typeof conflictListQuerySchema>
export type ConflictResolutionBody = z.infer<typeof conflictResolutionSchema>
