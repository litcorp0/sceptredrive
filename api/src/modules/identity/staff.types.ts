import type { Role } from '@gikautos/shared'
import type { z } from 'zod'
import type { user as userTable } from './staff.schema.ts'
import type {
  changePasswordSchema,
  createStaffSchema,
  staffIdParamSchema,
  staffListQuerySchema,
  updateStaffSchema,
} from './staff.validation.ts'

type UserSelect = typeof userTable.$inferSelect

/** Staff profile projection; never includes credential or PIN columns. */
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
  | 'twoFactorEnabled'
  | 'createdAt'
  | 'updatedAt'
>

export type StaffIdParams = z.infer<typeof staffIdParamSchema>
export type StaffCreateBody = z.infer<typeof createStaffSchema>
export type StaffUpdateBody = z.infer<typeof updateStaffSchema>
export type StaffListQuery = z.infer<typeof staffListQuerySchema>
export type ChangePasswordBody = z.infer<typeof changePasswordSchema>

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

export interface ChangeOwnPasswordInput {
  currentPassword: string
  newPassword: string
}

export interface InvitationData {
  to: string
  name: string
  temporaryPassword: string
}
