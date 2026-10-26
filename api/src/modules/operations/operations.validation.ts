import { z } from 'zod'
import { validateQuery } from '../../http/validation.ts'

/**
 * One optional branch, nothing else.
 *
 * `strict()` is the guard against a smuggled parameter: a caller cannot ask for
 * `?allBranches=true` or a made-up filter the service would silently ignore
 * while it wondered whether the request meant something (OWASP A01/A03). A
 * manager's own branch is supplied by `resolveBranchFilter`, so an admin is the
 * only caller who can send this and get anything other than their scope.
 */
export const operationsSummaryQuerySchema = z.object({ branchId: z.uuid().optional() }).strict()

export type OperationsSummaryQuery = z.infer<typeof operationsSummaryQuerySchema>

export const validateOperationsSummaryQuery = validateQuery(operationsSummaryQuerySchema)
