import type { TaxMode } from '@sceptre/shared'

/** The identity attached to a device-authenticated request. */
export interface DeviceAuthContext {
  deviceId: string
  terminalId: string
  branchId: string
}

export interface PosLoyaltyConfig {
  earnPointsPerCedi: number
  pointsPerCedi: number
  expiryMonths: number
  minimumRedeemPoints: number
}

export interface PosRuntimeConfig {
  maxCashierDiscountPercent: number
  maxManagerDiscountPercent: number
  pinMaxAttempts: number
  pinLockMinutes: number
  clockSkewToleranceMinutes: number
  syncBatchSize: number
  receiptFooter: string
  salesRequireOpenShift: boolean
}

/**
 * Everything the POS needs to run offline. Deliberately excludes staff records,
 * PIN hashes, customer lists, and secrets: the device gets policy, not data it
 * cannot be trusted with.
 */
export interface PosConfigSnapshot {
  taxMode: TaxMode
  loyalty: PosLoyaltyConfig
  pos: PosRuntimeConfig
  receiptHeader: string
  /** Server clock at issue time; the POS corrects for skew from this. */
  serverTime: string
  serverTimeZone: string
}

export interface PosSessionPayload {
  deviceId: string
  terminal: { id: string; code: string; name: string }
  branch: { id: string; code: string; name: string }
  /** Short-lived device JWT for `/api/pos/*` calls. */
  accessToken: string
  expiresAt: string
  config: PosConfigSnapshot
}

export interface PowersyncTokenPayload {
  endpoint: string
  token: string
  expiresAt: string
}

export type UploadTransactionType = 'SALE' | 'SHIFT_OPEN' | 'CASH_MOVEMENT' | 'SHIFT_CLOSE'

export interface UploadTransaction {
  clientTransactionId: string
  type: UploadTransactionType
  occurredAt: string
  payloadVersion: 1
  payload: unknown
}

export interface PosUploadBody {
  batchId: string
  deviceId: string
  terminalId: string
  transactions: UploadTransaction[]
}

export type UploadItemStatus = 'APPLIED' | 'REPLAYED' | 'REJECTED'

export interface UploadItemResult {
  clientTransactionId: string
  status: UploadItemStatus
  serverId: string | null
  conflicts: Array<{ id: string; type: string; severity: string }>
  resolved: { customerId?: string; saleId?: string; shiftId?: string }
  error?: { code: string; message: string }
}

export interface PosUploadResponse {
  batchId: string
  serverTime: string
  results: UploadItemResult[]
}

/** Stored in `pos_sync_transaction.result` and replayed verbatim. */
export interface StoredTransactionResult {
  status: 'APPLIED' | 'REJECTED'
  serverId: string | null
  conflicts: Array<{ id: string; type: string; severity: string }>
  resolved: { customerId?: string; saleId?: string; shiftId?: string }
  error?: { code: string; message: string }
}

export interface DeviceConflictItem {
  id: string
  type: string
  severity: string
  status: string
  saleReceiptNumber: string | null
  shiftNumber: string | null
  details: Record<string, unknown>
  createdAt: string
}

export interface DeviceSyncState {
  pendingConflicts: number
  lastSaleAt: string | null
  serverTime: string
  /** Latest settings change (ISO) so a terminal can detect a config refresh. */
  configVersion: string | null
}
