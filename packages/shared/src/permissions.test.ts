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

  it('lets managers run customer, credit, and loyalty operations', () => {
    expect(can('MANAGER', 'customer.read')).toBe(true)
    expect(can('MANAGER', 'customer.create')).toBe(true)
    expect(can('MANAGER', 'customer.update')).toBe(true)
    expect(can('MANAGER', 'credit.read')).toBe(true)
    expect(can('MANAGER', 'credit.profile.manage')).toBe(true)
    expect(can('MANAGER', 'credit.repayment')).toBe(true)
    expect(can('MANAGER', 'credit.adjust')).toBe(true)
    expect(can('MANAGER', 'credit.override')).toBe(true)
    expect(can('MANAGER', 'loyalty.read')).toBe(true)
    expect(can('MANAGER', 'loyalty.adjust')).toBe(true)
  })

  it('keeps customer erasure, archiving, and loyalty settings admin-only', () => {
    expect(can('MANAGER', 'customer.archive')).toBe(false)
    expect(can('MANAGER', 'customer.anonymize')).toBe(false)
    expect(can('MANAGER', 'loyalty.settings')).toBe(false)

    expect(can('ADMIN', 'customer.archive')).toBe(true)
    expect(can('ADMIN', 'customer.anonymize')).toBe(true)
    expect(can('ADMIN', 'loyalty.settings')).toBe(true)
  })

  it('keeps cashiers out of phase 4 permissions', () => {
    expect(can('CASHIER', 'customer.read')).toBe(false)
    expect(can('CASHIER', 'customer.create')).toBe(false)
    expect(can('CASHIER', 'credit.read')).toBe(false)
    expect(can('CASHIER', 'credit.override')).toBe(false)
    expect(can('CASHIER', 'loyalty.read')).toBe(false)
  })

  it('has no duplicate permissions', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length)
  })
})
