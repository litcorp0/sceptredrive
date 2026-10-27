import { REFUND_REASONS, TENDER_METHODS } from '@sceptre/shared'
import { z } from 'zod'
import { validateParam, validateQuery } from '../../http/validation.ts'

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
