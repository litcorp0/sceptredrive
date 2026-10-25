import type { z } from 'zod'
import type {
  SettingKey,
  settingsListQuerySchema,
  settingsUpdateSchema,
} from './settings.validation.ts'

export type { SettingKey, SettingValue } from './settings.validation.ts'

export type SettingsListQuery = z.infer<typeof settingsListQuerySchema>
export type SettingsUpdateBody = z.infer<typeof settingsUpdateSchema>

export interface ResolvedSetting {
  key: SettingKey
  value: unknown
  branchScoped: boolean
  /** `admin` keys are branch-overridable but only an admin may write them. */
  writableBy: 'admin' | 'manager'
  source: 'branch' | 'global' | 'default'
}

export interface UpdateSettingInput {
  key: string
  value: unknown
  branchId?: string | null | undefined
}
