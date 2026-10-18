import type { Role } from './roles.ts'

export const PERMISSIONS = [
  'branch.read',
  'branch.create',
  'branch.update',
  'branch.deactivate',
  'terminal.read',
  'terminal.create',
  'terminal.update',
  'terminal.revoke',
  'device.read',
  'device.revoke',
  'staff.read',
  'staff.create',
  'staff.update',
  'staff.reset-password',
  'catalog.read',
  'catalog.create',
  'catalog.update',
  'catalog.archive',
  'price.update',
  'price.override',
  'audit.read',
  'settings.read',
  'settings.update',
] as const

export type Permission = (typeof PERMISSIONS)[number]

const ADMIN_PERMISSIONS: readonly Permission[] = PERMISSIONS

const MANAGER_PERMISSIONS: readonly Permission[] = [
  'branch.read',
  'branch.update',
  'terminal.read',
  'terminal.create',
  'terminal.update',
  'terminal.revoke',
  'device.read',
  'device.revoke',
  'staff.read',
  'staff.create',
  'staff.update',
  'staff.reset-password',
  'catalog.read',
  'price.override',
  'audit.read',
  'settings.read',
  'settings.update',
]

// Cashiers authenticate on the POS (device-bound PIN) and never call the admin API.
const CASHIER_PERMISSIONS: readonly Permission[] = []

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ADMIN: ADMIN_PERMISSIONS,
  MANAGER: MANAGER_PERMISSIONS,
  CASHIER: CASHIER_PERMISSIONS,
}

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}
