import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'
import {
  terminalCreateSchema,
  terminalIdParamSchema,
  terminalListQuerySchema,
  terminalUpdateSchema,
} from './terminals.schema.ts'

export const validateTerminalCreate = validateJson(terminalCreateSchema)
export const validateTerminalUpdate = validateJson(terminalUpdateSchema)
export const validateTerminalListQuery = validateQuery(terminalListQuerySchema)
export const validateTerminalIdParam = validateParam(terminalIdParamSchema)
