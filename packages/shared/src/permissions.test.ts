import { describe, expect, it } from 'vitest'
import { can, PERMISSIONS, ROLE_PERMISSIONS } from './permissions.ts'

describe('permissions', () => {
  it('gives admins every permission', () => {
    for (const permission of PERMISSIONS) {
      expect(can('ADMIN', permission)).toBe(true)
    }
  })

  it('keeps managers out of branch creation, deactivation, and settings', () => {
    expect(can('MANAGER', 'branch.create')).toBe(false)
    expect(can('MANAGER', 'branch.deactivate')).toBe(false)
    expect(can('MANAGER', 'branch.update')).toBe(true)
    expect(can('MANAGER', 'staff.create')).toBe(true)
    expect(can('MANAGER', 'staff.reset-password')).toBe(true)
    expect(can('MANAGER', 'settings.update')).toBe(true)
  })

  it('gives managers catalog read and own-branch price overrides only', () => {
    expect(can('MANAGER', 'catalog.read')).toBe(true)
    expect(can('MANAGER', 'price.override')).toBe(true)
    expect(can('MANAGER', 'catalog.create')).toBe(false)
    expect(can('MANAGER', 'catalog.update')).toBe(false)
    expect(can('MANAGER', 'catalog.archive')).toBe(false)
    expect(can('MANAGER', 'price.update')).toBe(false)
  })

  it('gives admins every catalog and price permission', () => {
    expect(can('ADMIN', 'catalog.read')).toBe(true)
    expect(can('ADMIN', 'catalog.create')).toBe(true)
    expect(can('ADMIN', 'catalog.update')).toBe(true)
    expect(can('ADMIN', 'catalog.archive')).toBe(true)
    expect(can('ADMIN', 'price.update')).toBe(true)
    expect(can('ADMIN', 'price.override')).toBe(true)
  })

  it('gives cashiers no admin permissions', () => {
    expect(ROLE_PERMISSIONS.CASHIER).toHaveLength(0)
    expect(can('CASHIER', 'branch.read')).toBe(false)
    expect(can('CASHIER', 'audit.read')).toBe(false)
    expect(can('CASHIER', 'catalog.read')).toBe(false)
    expect(can('CASHIER', 'price.override')).toBe(false)
  })

  it('lets managers run inventory operations for their branch', () => {
    expect(can('MANAGER', 'inventory.read')).toBe(true)
    expect(can('MANAGER', 'inventory.receive')).toBe(true)
    expect(can('MANAGER', 'inventory.adjust')).toBe(true)
    expect(can('MANAGER', 'inventory.transfer')).toBe(true)
    expect(can('MANAGER', 'inventory.count')).toBe(true)
    expect(can('MANAGER', 'inventory.threshold')).toBe(true)
    expect(can('CASHIER', 'inventory.read')).toBe(false)
    expect(can('CASHIER', 'inventory.adjust')).toBe(false)
  })

  it('has no duplicate permissions', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length)
  })
})
