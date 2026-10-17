import { validateJson, validateQuery } from '../../http/validation.ts'
import { settingsListQuerySchema, settingsUpdateSchema } from './settings.schema.ts'

export const validateSettingsListQuery = validateQuery(settingsListQuerySchema)
export const validateSettingsUpdate = validateJson(settingsUpdateSchema)
