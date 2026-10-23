import type { Role } from '@gikautos/shared'
import type { DeviceAuthContext } from '../sync/sync.types.ts'

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

// --- Offline sale payload (Plan 06/07 produce this; the uploader ships it) ----

/** A manager approval captured on the terminal (D22). Never contains a PIN. */
export interface OverrideProof {
  staffId: string
  userId: string
  bindingId: string
  pinVersion: number
  /** Plan 06 labels or the credit enum values; normalized server-side. */
  reasonCode: string
  note?: string | null
  occurredAt: string
}

export interface SaleCashier {
  userId: string
  staffId: string
  bindingId: string
  /** Returned once at authorization; hashed before lookup, never logged. */
  bindingToken: string
  pinVersion: number
}

export interface SaleCustomerPayload {
  id: string
  phone: string
  name?: string | undefined
}

export interface SaleLinePayload {
  productId: string
  quantity: number
  unitPriceMinor: number
  lineDiscountMinor: number
  taxCategory: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT'
}

export interface SaleDiscountPayload {
  amountMinor: number
  reasonCode: 'STAFF' | 'DAMAGE' | 'PROMO' | 'OTHER'
  note?: string | null
  override?: OverrideProof | null
}

export interface SaleLoyaltyPayload {
  redeemPoints: number
  /** The terminal's earn preview; a difference is a rate-change conflict. */
  earnPreviewPoints: number
}

export interface SaleTenderPayload {
  method: 'CASH' | 'CREDIT'
  /** Cash: the amount handed over (change included). Credit: the sale total. */
  amountMinor: number
  override?: OverrideProof | null
}

export interface SaleTotalsPayload {
  subtotalMinor: number
  lineDiscountMinor: number
  saleDiscountMinor: number
  loyaltyDiscountMinor: number
  vatMinor: number
  nhilMinor: number
  getfundMinor: number
  taxTotalMinor: number
  totalMinor: number
  changeMinor: number
}

export interface SalePayload {
  receiptNumber: string
  shiftId: string
  cashier: SaleCashier
  customer?: SaleCustomerPayload | null
  lines: SaleLinePayload[]
  saleDiscount?: SaleDiscountPayload | null
  loyalty?: SaleLoyaltyPayload | null
  tenders: SaleTenderPayload[]
  totals: SaleTotalsPayload
  occurredAt: string
  appVersion?: string | null
}

export type SyncConflictType =
  | 'STOCK_OVERSELL'
  | 'CREDIT_OVER_LIMIT'
  | 'CREDIT_HOLD'
  | 'LOYALTY_NEGATIVE'
  | 'LOYALTY_RATE_CHANGED'
  | 'PRICE_MISMATCH'
  | 'TOTAL_MISMATCH'
  | 'SHIFT_VARIANCE_MISMATCH'
  | 'STALE_CREDENTIALS'
  | 'OVERRIDE_INVALID'
  | 'DUPLICATE_CUSTOMER'
  | 'CLOCK_SKEW'
  | 'INVALID_CUSTOMER'
  | 'UNKNOWN_PRODUCT'

export type SyncConflictSeverity = 'LOW' | 'MEDIUM' | 'HIGH'

export interface AppliedConflict {
  id: string
  type: SyncConflictType
  severity: SyncConflictSeverity
}

export interface SaleApplyResult {
  saleId: string
  conflicts: AppliedConflict[]
  resolvedCustomerId: string | null
}

/** Context the upload dispatcher owns (one client transaction, one sale). */
export interface SaleContext {
  clientTransactionId: string
  device: DeviceAuthContext
  /** Server clock at receipt; written beside the device's `occurredAt`. */
  receivedAt: Date
  clockSkewToleranceMinutes: number
}
