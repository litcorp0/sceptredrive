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

  it('keeps managers out of catalogue creation, updates, and archiving', () => {
    expect(can('MANAGER', 'catalog.read')).toBe(true)
    expect(can('MANAGER', 'price.override')).toBe(true)
    // Phase 11 (MGR-02): submitting a product is `procurement.create`, not
    // `catalog.create` — `catalog.create` also guards categories, brands, and
    // units, and a manager has no business creating those directly. Editing a
    // product's base price is price policy, which stays admin.
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

  it('lets managers read suppliers, create them, and run payables — never edit or archive', () => {
    expect(can('MANAGER', 'supplier.read')).toBe(true)
    // Phase 11 (MGR-01): a manager may add a supplier they need to order from.
    expect(can('MANAGER', 'supplier.create')).toBe(true)
    expect(can('MANAGER', 'supplier.update')).toBe(false)
    expect(can('MANAGER', 'supplier.archive')).toBe(false)

    expect(can('MANAGER', 'payable.read')).toBe(true)
    expect(can('MANAGER', 'payable.invoice.manage')).toBe(true)
    expect(can('MANAGER', 'payable.payment')).toBe(true)
    expect(can('MANAGER', 'payable.void')).toBe(true)

    expect(can('ADMIN', 'supplier.create')).toBe(true)
    expect(can('ADMIN', 'supplier.archive')).toBe(true)
    expect(can('ADMIN', 'payable.void')).toBe(true)
  })

  it('keeps cashiers out of phase 5 permissions', () => {
    expect(can('CASHIER', 'supplier.read')).toBe(false)
    expect(can('CASHIER', 'payable.read')).toBe(false)
    expect(can('CASHIER', 'payable.invoice.manage')).toBe(false)
    expect(can('CASHIER', 'payable.payment')).toBe(false)
    expect(can('CASHIER', 'payable.void')).toBe(false)
  })

  it('lets managers reset pins and approve discounts, never cashiers', () => {
    expect(can('MANAGER', 'staff.pin.reset')).toBe(true)
    expect(can('MANAGER', 'pos.discount')).toBe(true)
    expect(can('ADMIN', 'staff.pin.reset')).toBe(true)
    expect(can('ADMIN', 'pos.discount')).toBe(true)

    expect(can('CASHIER', 'staff.pin.reset')).toBe(false)
    expect(can('CASHIER', 'pos.discount')).toBe(false)
  })

  it('grants refund authority to managers and admins, never cashiers', () => {
    // P13-D36: a refund is authorised by a manager PIN at the till and checked
    // by `validateOverrideProof` on the server. The cashier's array stays empty.
    expect(can('ADMIN', 'pos.refund')).toBe(true)
    expect(can('MANAGER', 'pos.refund')).toBe(true)
    expect(can('CASHIER', 'pos.refund')).toBe(false)

    expect(ROLE_PERMISSIONS.ADMIN).toHaveLength(66)
    expect(ROLE_PERMISSIONS.MANAGER).toHaveLength(54)
    expect(ROLE_PERMISSIONS.CASHIER).toHaveLength(0)
  })

  it('gives managers oversight, conflict, transfer and E-VAT reading — never E-VAT retry', () => {
    // P14-D5: a failed GRA submission is a compliance matter, not a branch
    // one, so retrying it is an admin action.
    expect(can('MANAGER', 'pos.oversight.read')).toBe(true)
    expect(can('MANAGER', 'conflict.read')).toBe(true)
    expect(can('MANAGER', 'conflict.resolve')).toBe(true)
    expect(can('MANAGER', 'payable.transfer')).toBe(true)
    expect(can('MANAGER', 'evat.read')).toBe(true)
    expect(can('MANAGER', 'evat.retry')).toBe(false)

    expect(can('ADMIN', 'evat.retry')).toBe(true)
    expect(ROLE_PERMISSIONS.CASHIER).not.toContain('pos.oversight.read')
  })

  it('keeps pos.refund beside pos.discount in the permission list', () => {
    const discount = PERMISSIONS.indexOf('pos.discount')
    expect(PERMISSIONS[discount + 1]).toBe('pos.refund')
  })

  it('lets managers and admins read analytics, never cashiers', () => {
    expect(can('ADMIN', 'analytics.read')).toBe(true)
    expect(can('MANAGER', 'analytics.read')).toBe(true)
    expect(can('CASHIER', 'analytics.read')).toBe(false)
  })

  it('lets managers order and receive, and read and decide approvals', () => {
    expect(can('MANAGER', 'procurement.read')).toBe(true)
    expect(can('MANAGER', 'procurement.create')).toBe(true)
    expect(can('MANAGER', 'procurement.receive')).toBe(true)
    expect(can('MANAGER', 'procurement.return')).toBe(true)
    // P12-D1: `procurement.approve` is retired. A manager holds `approval.decide`
    // because the authority stored on the row — not the permission alone — decides
    // whether they may use it (P12-D2).
    expect(can('MANAGER', 'approval.read')).toBe(true)
    expect(can('MANAGER', 'approval.decide')).toBe(true)

    expect(can('ADMIN', 'procurement.read')).toBe(true)
    expect(can('ADMIN', 'procurement.create')).toBe(true)
    expect(can('ADMIN', 'procurement.receive')).toBe(true)
    expect(can('ADMIN', 'procurement.return')).toBe(true)
    expect(can('ADMIN', 'approval.read')).toBe(true)
    expect(can('ADMIN', 'approval.decide')).toBe(true)
  })

  it('keeps cashiers out of procurement and approvals entirely', () => {
    expect(can('CASHIER', 'procurement.read')).toBe(false)
    expect(can('CASHIER', 'procurement.create')).toBe(false)
    expect(can('CASHIER', 'procurement.receive')).toBe(false)
    expect(can('CASHIER', 'procurement.return')).toBe(false)
    expect(can('CASHIER', 'approval.read')).toBe(false)
    expect(can('CASHIER', 'approval.decide')).toBe(false)
  })

  it('retires procurement.approve: one name for one action', () => {
    expect(PERMISSIONS).not.toContain('procurement.approve')
    expect(ROLE_PERMISSIONS.ADMIN).not.toContain('procurement.approve')
    expect(ROLE_PERMISSIONS.MANAGER).not.toContain('procurement.approve')
    expect(ROLE_PERMISSIONS.ADMIN).toEqual(PERMISSIONS)
  })

  it('has no duplicate permissions', () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length)
  })
})
