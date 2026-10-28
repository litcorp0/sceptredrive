import type { Role } from '@sceptre/shared'
import type { z } from 'zod'
import type { user as userTable } from './staff.schema.ts'
import type {
  changePasswordSchema,
  createStaffSchema,
  setStaffPinSchema,
  staffIdParamSchema,
  staffListQuerySchema,
  updateStaffSchema,
} from './staff.validation.ts'

type UserSelect = typeof userTable.$inferSelect

/** Staff profile projection; never includes credential columns or the PIN hash. */
export type StaffRow = Pick<
  UserSelect,
  | 'id'
  | 'name'
  | 'email'
  | 'role'
  | 'branchId'
  | 'staffId'
  | 'phone'
  | 'isActive'
  | 'mustChangePassword'
  | 'pinVersion'
  | 'pinMustChange'
  | 'createdAt'
  | 'updatedAt'
>

/** PIN metadata for the console; `activeBindings` counts live terminal bindings. */
export interface StaffPinState {
  hasPin: boolean
  pinVersion: number
  pinMustChange: boolean
  activeBindings: number
}

export type StaffIdParams = z.infer<typeof staffIdParamSchema>
export type StaffCreateBody = z.infer<typeof createStaffSchema>
export type StaffUpdateBody = z.infer<typeof updateStaffSchema>
export type StaffListQuery = z.infer<typeof staffListQuerySchema>
export type ChangePasswordBody = z.infer<typeof changePasswordSchema>
export type SetStaffPinBody = z.infer<typeof setStaffPinSchema>

export interface CreateStaffInput {
  email: string
  name: string
  role: Role
  branchId?: string | null | undefined
  phone?: string | undefined
}

export interface CreateStaffResult {
  staff: StaffRow
  temporaryPassword: string
  temporaryPin: string | null
  invitationSent: boolean
}

export interface ListStaffFilters {
  role?: Role | undefined
  branchId?: string | undefined
  includeInactive: boolean
  search?: string | undefined
  limit: number
  offset: number
}

export interface UpdateStaffInput {
  name?: string | undefined
  phone?: string | undefined
  role?: Role | undefined
  branchId?: string | null | undefined
}

export interface ResetPasswordResult {
  temporaryPassword: string
  invitationSent: boolean
}

/** The PIN itself is never echoed: only the version the terminal must adopt. */
export interface SetPinResult {
  staffId: string
  pinVersion: number
}

/** A generated PIN is returned once so the console can show it after email. */
export interface ResetPinResult {
  staffId: string
  pinVersion: number
  temporaryPin: string
  invitationSent: boolean
}

export interface ChangeOwnPasswordInput {
  currentPassword: string
  newPassword: string
}

export interface InvitationData {
  to: string
  name: string
  staffId: string | null
  role: string
  temporaryPassword?: string | undefined
  temporaryPin?: string | undefined
}
