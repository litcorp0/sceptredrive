export const ROLES = ['ADMIN', 'MANAGER', 'CASHIER'] as const

export type Role = (typeof ROLES)[number]

export const BRANCH_TYPES = ['RETAIL', 'WAREHOUSE'] as const

export type BranchType = (typeof BRANCH_TYPES)[number]

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value)
}

export function isBranchType(value: string): value is BranchType {
  return (BRANCH_TYPES as readonly string[]).includes(value)
}
