import type { Role } from '@gikautos/shared'

/** The staff identity a terminal may bind to, with the columns needed to verify a PIN. */
export interface DeviceStaffRecord {
  userId: string
  staffId: string
  name: string
  role: Role
  branchId: string | null
  isActive: boolean
  pinHash: string | null
  pinVersion: number
  pinMustChange: boolean
}

export interface BindingStaff {
  userId: string
  staffId: string
  name: string
  role: Role
}

/** Returned exactly once, when a binding is created or replaced. */
export interface StaffBindingResult {
  bindingId: string
  bindingToken: string
  expiresAt: string
  staff: BindingStaff
  pinVersion: number
  mustChangePin: boolean
}

/** Answer to the boot-time binding check. Never carries a credential. */
export interface BindingValidationResult {
  valid: boolean
  staff: BindingStaff | null
  pinVersion: number | null
  mustChangePin: boolean
  bindingId: string | null
}

// --- Shift lifecycle (Plan 05's upload dispatcher calls these) ---------------

export interface ShiftOpenPayload {
  shiftId: string
  number: string
  openingFloatMinor: number
  cashierUserId: string
  cashierStaffId: string
  occurredAt: string
}

export interface CashMovementPayload {
  id: string
  shiftId: string
  type: 'CASH_IN' | 'CASH_OUT'
  amountMinor: number
  reason: string
  occurredAt: string
  staffUserId: string
  staffStaffId: string
}

export interface ShiftClosePayload {
  shiftId: string
  countedCashMinor: number
  clientExpectedCashMinor: number
  closeNote?: string | undefined
  occurredAt: string
}

export interface ShiftApplyResult {
  shiftId: string
  serverExpectedCashMinor?: number
  varianceMinor?: number
  conflictId?: string
}

/** Everything needed to compute a shift's expected cash at the server. */
export interface ShiftCashTotals {
  openingFloatMinor: number
  cashTendersMinor: number
  changeMinor: number
  cashInMinor: number
  cashOutMinor: number
}
