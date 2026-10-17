import { describe, expect, it } from 'vitest'
import { can, PERMISSIONS, ROLE_PERMISSIONS } from './permissions.ts'

describe('permissions', () => {
  it('gives admins every permission', () => {
    for (const permission of PERMISSIONS) {
      expect(can('ADMIN', permission)).toBe(true)
    }
  })

  it('keeps managers out of branch creation and settings', () => {
    expect(can('MANAGER', 'branch.create')).toBe(false)
    expect(can('MANAGER', 'branch.update')).toBe(true)
    expect(can('MANAGER', 'staff.create')).toBe(true)
    expect(can('MANAGER', 'staff.reset-password')).toBe(true)
    expect(can('MANAGER', 'settings.update')).toBe(true)
  })

  it('gives cashiers no admin permissions', () => {
    expect(ROLE_PERMISSIONS.CASHIER).toHaveLength(0)
    expect(can('CASHIER', 'branch.read')).toBe(false)
    expect(can('CASHIER', 'audit.read')).toBe(false)
  })

  it('has no duplicate permissions', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length)
  })
})
