import type { z } from 'zod'
import type {
  SettingKey,
  settingsListQuerySchema,
  settingsUpdateSchema,
} from './settings.schema.ts'

export type { SettingKey, SettingValue } from './settings.schema.ts'

export type SettingsListQuery = z.infer<typeof settingsListQuerySchema>
export type SettingsUpdateBody = z.infer<typeof settingsUpdateSchema>

export interface ResolvedSetting {
  key: SettingKey
  value: unknown
  branchScoped: boolean
  source: 'branch' | 'global' | 'default'
}

export interface UpdateSettingInput {
  key: string
  value: unknown
  branchId?: string | null | undefined
}
