import type { PowerSyncDatabase } from '@powersync/web'
import { describe, expect, it, vi } from 'vitest'
import { BindingError, type LocalStaffBinding } from '../auth/bindings'
import { approveOverride, listApprovers, OverrideError, reasonCodesFor } from './override-service'

const db = {} as PowerSyncDatabase
const POLICY = { maxAttempts: 5, lockMinutes: 5 }

function binding(overrides: Partial<LocalStaffBinding> = {}): LocalStaffBinding {
  return {
    id: '22222222-2222-7222-8222-222222222222',
    userId: 'user-manager',
    staffId: 'GA-0002',
    name: 'Efua Owusu',
    role: 'MANAGER',
    bindingId: '22222222-2222-7222-8222-222222222222',
    bindingToken: 'token',
    expiresAt: '2027-01-01T00:00:00.000Z',
    pinSalt: 'salt',
    pinVerifier: 'verifier',
    pinVersion: 3,
    pinMustChange: false,
    failedAttempts: 0,
    lockedUntil: null,
    isActive: true,
    boundAt: '2026-10-01T00:00:00.000Z',
    ...overrides,
  }
}

const NOW = new Date('2026-10-23T10:00:00.000Z')

describe('approveOverride', () => {
  it('returns a proof for an authorized manager with a valid PIN', async () => {
    const manager = binding()
    const proof = await approveOverride(
      db,
      {
        approverBindingId: manager.id,
        pin: '1234',
        policy: POLICY,
        permission: 'pos.discount',
        reasonCode: 'STAFF',
        note: '  Regular customer  ',
      },
      {
        getBinding: async () => manager,
        verifyPin: async () => manager,
        now: () => NOW,
      },
    )

    expect(proof).toEqual({
      approverUserId: 'user-manager',
      approverStaffId: 'GA-0002',
      approverRole: 'MANAGER',
      bindingId: manager.bindingId,
      pinVersion: 3,
      reasonCode: 'STAFF',
      note: 'Regular customer',
      approvedAt: NOW.toISOString(),
    })
  })

  it('refuses a cashier, who never carries the permission', async () => {
    const cashier = binding({ role: 'CASHIER', staffId: 'GA-0003' })
    const verifyPin = vi.fn()

    await expect(
      approveOverride(
        db,
        {
          approverBindingId: cashier.id,
          pin: '1234',
          policy: POLICY,
          permission: 'pos.discount',
          reasonCode: 'STAFF',
        },
        { getBinding: async () => cashier, verifyPin },
      ),
    ).rejects.toMatchObject({ code: 'NOT_AUTHORIZED' })

    // The PIN is never even checked for an unauthorized approver.
    expect(verifyPin).not.toHaveBeenCalled()
  })

  it('refuses an unknown binding', async () => {
    await expect(
      approveOverride(
        db,
        {
          approverBindingId: 'missing',
          pin: '1234',
          policy: POLICY,
          permission: 'credit.override',
          reasonCode: 'OTHER',
        },
        { getBinding: async () => null },
      ),
    ).rejects.toBeInstanceOf(OverrideError)
  })

  it('refuses a reason code that belongs to the other kind of exception', async () => {
    const manager = binding()
    await expect(
      approveOverride(
        db,
        {
          approverBindingId: manager.id,
          pin: '1234',
          policy: POLICY,
          permission: 'credit.override',
          reasonCode: 'PROMO',
        },
        { getBinding: async () => manager, verifyPin: async () => manager },
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REASON' })
  })

  it('propagates a wrong PIN without producing a proof', async () => {
    const manager = binding()
    await expect(
      approveOverride(
        db,
        {
          approverBindingId: manager.id,
          pin: '0000',
          policy: POLICY,
          permission: 'pos.discount',
          reasonCode: 'STAFF',
        },
        {
          getBinding: async () => manager,
          verifyPin: async () => {
            throw new BindingError('INVALID', 'Wrong PIN', { remainingAttempts: 4 })
          },
        },
      ),
    ).rejects.toBeInstanceOf(BindingError)
  })

  it('accepts an admin', async () => {
    const admin = binding({ role: 'ADMIN', staffId: 'GA-0001' })
    const proof = await approveOverride(
      db,
      {
        approverBindingId: admin.id,
        pin: '1234',
        policy: POLICY,
        permission: 'credit.override',
        reasonCode: 'CUSTOMER_REQUEST',
      },
      { getBinding: async () => admin, verifyPin: async () => admin, now: () => NOW },
    )
    expect(proof.approverRole).toBe('ADMIN')
    expect(proof.note).toBeNull()
  })
})

describe('reasonCodesFor', () => {
  it('keeps discount and credit reasons apart', () => {
    expect(reasonCodesFor('pos.discount')).toEqual(['STAFF', 'DAMAGE', 'PROMO', 'OTHER'])
    expect(reasonCodesFor('credit.override')).toEqual(['CUSTOMER_REQUEST', 'APPROVED', 'OTHER'])
  })

  it('uses the refund vocabulary for a refund approval', () => {
    expect(reasonCodesFor('pos.refund')).toContain('DEFECTIVE')
    expect(reasonCodesFor('pos.refund')).toContain('OTHER')
  })

  it('refuses a cashier binding for a refund, even with a valid PIN', async () => {
    const cashier = binding({ role: 'CASHIER', staffId: 'GA-0003' })
    await expect(
      approveOverride(
        db,
        {
          approverBindingId: cashier.id,
          pin: '1234',
          policy: POLICY,
          permission: 'pos.refund',
          reasonCode: 'DEFECTIVE',
        },
        { getBinding: async () => cashier, verifyPin: async () => cashier },
      ),
    ).rejects.toBeInstanceOf(OverrideError)
  })
})

describe('listApprovers', () => {
  it('returns only manager and admin bindings', async () => {
    const row = (id: string, role: string) => ({
      id,
      user_id: `user-${id}`,
      staff_id: `GA-${id}`,
      name: `Staff ${id}`,
      role,
      binding_id: id,
      binding_token: 'token',
      expires_at: '2027-01-01T00:00:00.000Z',
      pin_salt: 'salt',
      pin_verifier: 'verifier',
      pin_version: 1,
      pin_must_change: 0,
      failed_attempts: 0,
      locked_until: null,
      is_active: 1,
      bound_at: '2026-10-01T00:00:00.000Z',
    })

    const fakeDb = {
      getAll: async () => [row('a', 'MANAGER'), row('b', 'ADMIN'), row('c', 'CASHIER')],
    } as unknown as PowerSyncDatabase

    const approvers = await listApprovers(fakeDb)
    expect(approvers.map((approver) => approver.role)).toEqual(['MANAGER', 'ADMIN'])
  })
})
