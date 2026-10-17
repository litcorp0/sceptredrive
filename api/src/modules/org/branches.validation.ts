import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'
import {
  branchCreateSchema,
  branchIdParamSchema,
  branchListQuerySchema,
  branchUpdateSchema,
  suggestCodeQuerySchema,
} from './branches.schema.ts'

export const validateBranchCreate = validateJson(branchCreateSchema)
export const validateBranchUpdate = validateJson(branchUpdateSchema)
export const validateBranchListQuery = validateQuery(branchListQuerySchema)
export const validateSuggestCodeQuery = validateQuery(suggestCodeQuerySchema)
export const validateBranchIdParam = validateParam(branchIdParamSchema)
