import { validateJson, validateParam, validateQuery } from '../../http/validation.ts'
import {
  changePasswordSchema,
  createStaffSchema,
  staffIdParamSchema,
  staffListQuerySchema,
  updateStaffSchema,
} from './staff.schema.ts'

export const validateStaffCreate = validateJson(createStaffSchema)
export const validateStaffUpdate = validateJson(updateStaffSchema)
export const validateStaffListQuery = validateQuery(staffListQuerySchema)
export const validateStaffIdParam = validateParam(staffIdParamSchema)
export const validateChangePassword = validateJson(changePasswordSchema)
