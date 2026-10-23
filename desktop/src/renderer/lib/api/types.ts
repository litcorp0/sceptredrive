/**
 * Mirrors of the API payloads the POS consumes. Hand-maintained like the admin
 * console's `api-types.ts`; the API tests pin the server side, the desktop tests
 * pin these shapes.
 */

export type TaxMode = 'INCLUSIVE' | 'EXCLUSIVE'

export interface PosLoyaltyConfig {
  earnPointsPerCedi: number
  pointsPerCedi: number
  expiryMonths: number
  minimumRedeemPoints: number
}

export interface PosRuntimeSettings {
  maxCashierDiscountPercent: number
  maxManagerDiscountPercent: number
  pinMaxAttempts: number
  pinLockMinutes: number
  clockSkewToleranceMinutes: number
  syncBatchSize: number
  receiptFooter: string
  salesRequireOpenShift: boolean
}

export interface PosConfigSnapshot {
  taxMode: TaxMode
  loyalty: PosLoyaltyConfig
  pos: PosRuntimeSettings
  receiptHeader: string
  serverTime: string
  serverTimeZone: string
}

export interface PosSessionPayload {
  deviceId: string
  terminal: { id: string; code: string; name: string }
  branch: { id: string; code: string; name: string }
  accessToken: string
  expiresAt: string
  config: PosConfigSnapshot
}

export interface PowersyncTokenPayload {
  endpoint: string
  token: string
  expiresAt: string
}

/** `POST /api/pos/staff/authorize` and `/change-pin`; the token is returned once. */
export interface PosStaffBindingPayload {
  bindingId: string
  bindingToken: string
  expiresAt: string
  staff: { userId: string; staffId: string; name: string; role: 'ADMIN' | 'MANAGER' | 'CASHIER' }
  pinVersion: number
  mustChangePin: boolean
}

export interface PosBindingValidationPayload {
  valid: boolean
  staff: {
    userId: string
    staffId: string
    name: string
    role: 'ADMIN' | 'MANAGER' | 'CASHIER'
  } | null
  pinVersion: number | null
  mustChangePin: boolean
  bindingId: string | null
}

/** Enrollment redemption response (returned once). */
export interface EnrolledDevice {
  deviceId: string
  deviceToken: string
  terminalId: string
  terminalCode: string
  branchId: string
  branchName: string
  branchCode: string
}

export interface ApiErrorBody {
  error: {
    message: string
    code: string
    requestId?: string
    details?: Record<string, unknown>
  }
}

/**
 * Plan 08 upload envelope — one client transaction per item. Defined here so the
 * outbox writer and the uploader share a single shape.
 */
export interface PosUploadTransaction {
  clientTransactionId: string
  type: 'SALE' | 'SHIFT_OPEN' | 'CASH_MOVEMENT' | 'SHIFT_CLOSE'
  occurredAt: string
  payloadVersion: number
  payload: unknown
}

export interface PosUploadRequest {
  deviceId: string
  transactions: PosUploadTransaction[]
}

export type PosUploadItemResult =
  | { clientTransactionId: string; status: 'APPLIED' | 'REPLAYED'; result: unknown }
  | {
      clientTransactionId: string
      status: 'REJECTED'
      error: { code: string; message: string }
    }

export interface PosUploadResponse {
  results: PosUploadItemResult[]
}
