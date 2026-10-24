import type { PowerSyncDatabase } from '@powersync/web'
import { can, type Permission } from '@sceptre/shared'
import {
  type BindingError,
  getBinding,
  type LocalStaffBinding,
  listBindings,
  verifyOfflinePin,
} from '../auth/bindings'
import type { LockoutPolicy } from '../auth/pin'
import type { CartOverrideProof } from '../cart/types'
import { CREDIT_REASON_CODES, DISCOUNT_REASON_CODES } from '../cart/types'

/**
 * Manager overrides at the till (Plan 06 Task 5, D22).
 *
 * The cashier cannot approve their own exception: the approver must be an
 * authorized MANAGER or ADMIN whose binding carries the required permission.
 * Verification uses that manager's own offline PIN and lockout counters, and
 * the resulting proof is stored on the cart so the sale can ship it — the
 * server revalidates everything and raises `OVERRIDE_INVALID` if the claim no
 * longer holds (the sale still applies).
 */

export type OverridePermission = Extract<Permission, 'credit.override' | 'pos.discount'>

export type OverrideErrorCode = 'NOT_FOUND' | 'NOT_AUTHORIZED' | 'INVALID_REASON'

export class OverrideError extends Error {
  readonly code: OverrideErrorCode

  constructor(code: OverrideErrorCode, message: string) {
    super(message)
    this.name = 'OverrideError'
    this.code = code
  }
}

export function reasonCodesFor(permission: OverridePermission): readonly string[] {
  return permission === 'credit.override' ? CREDIT_REASON_CODES : DISCOUNT_REASON_CODES
}

/** Everyone who could approve something on this terminal. */
export async function listApprovers(db: PowerSyncDatabase): Promise<LocalStaffBinding[]> {
  const bindings = await listBindings(db)
  return bindings.filter(
    (binding) =>
      (binding.role === 'MANAGER' || binding.role === 'ADMIN') && binding.bindingId !== '',
  )
}

export interface OverrideApprovalInput {
  approverBindingId: string
  pin: string
  policy: LockoutPolicy
  permission: OverridePermission
  reasonCode: string
  note?: string | null
}

export interface OverrideDeps {
  getBinding?: (db: PowerSyncDatabase, bindingId: string) => Promise<LocalStaffBinding | null>
  verifyPin?: (
    db: PowerSyncDatabase,
    bindingId: string,
    pin: string,
    policy: LockoutPolicy,
  ) => Promise<LocalStaffBinding>
  now?: () => Date
}

/**
 * Verifies the manager's PIN and returns the proof to store on the cart.
 *
 * Throws `OverrideError` for authorization problems and the bindings module's
 * `BindingError` for PIN/lockout/expiry problems, so the dialog can show the
 * real reason without leaking anything sensitive.
 */
export async function approveOverride(
  db: PowerSyncDatabase,
  input: OverrideApprovalInput,
  deps: OverrideDeps = {},
): Promise<CartOverrideProof> {
  const get = deps.getBinding ?? getBinding
  const verify = deps.verifyPin ?? verifyOfflinePin

  const approver = await get(db, input.approverBindingId)
  if (!approver) {
    throw new OverrideError('NOT_FOUND', 'That staff member is not authorized on this terminal')
  }

  // Role first: a cashier binding never carries these permissions, so a
  // cashier cannot approve their own (or anyone's) exception.
  if (approver.role !== 'MANAGER' && approver.role !== 'ADMIN') {
    throw new OverrideError('NOT_AUTHORIZED', 'Only a manager or admin can approve this')
  }
  if (!can(approver.role, input.permission)) {
    throw new OverrideError('NOT_AUTHORIZED', 'This staff member cannot approve this')
  }
  if (!reasonCodesFor(input.permission).includes(input.reasonCode)) {
    throw new OverrideError('INVALID_REASON', 'Choose a reason for this override')
  }

  const verified = await verify(db, input.approverBindingId, input.pin, input.policy)
  const approvedAt = (deps.now?.() ?? new Date()).toISOString()

  return {
    approverUserId: verified.userId,
    approverStaffId: verified.staffId,
    approverRole: verified.role,
    bindingId: verified.bindingId,
    pinVersion: verified.pinVersion,
    reasonCode: input.reasonCode,
    note: input.note?.trim() ? input.note.trim().slice(0, 200) : null,
    approvedAt,
  }
}

/** Re-exported for callers that catch PIN problems separately from overrides. */
export type { BindingError }
