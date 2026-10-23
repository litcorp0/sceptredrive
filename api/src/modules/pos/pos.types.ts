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
