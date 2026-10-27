import type { RefundReason, RefundRestock, TaxMode } from '@sceptre/shared'

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

export type UploadTransactionType =
  | 'SALE'
  | 'SHIFT_OPEN'
  | 'CASH_MOVEMENT'
  | 'SHIFT_CLOSE'
  | 'REFUND'

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

// --- Refund payload (Plan 05) ------------------------------------------------

/** The staff member taking the return; the same proof a sale carries. */
export interface RefundCashier {
  userId: string
  staffId: string
  bindingId: string
  bindingToken: string
  pinVersion: number
}

export interface RefundLinePayload {
  saleLineId: string
  quantity: number
  restock: RefundRestock
  /** Required for `DAMAGED`, forbidden otherwise (P13-D22). */
  damageReason?: string | null
}

/** How much of the refund the customer gets back on one sale tender (P13-D19). */
export interface RefundTenderPayload {
  saleTenderId: string
  amountMinor: number
}

/**
 * A refund as the till uploads it. `refund.id` is the upload's
 * `clientTransactionId` (P13-D18), the number comes from the till's local
 * sequence because a refund must be numberable offline (P13-D37), and the
 * approver is proven once per document (P13-D24).
 */
export interface RefundPayload {
  saleId: string
  number: string
  shiftId: string
  cashier: RefundCashier
  reasonCode: RefundReason
  note?: string | null
  approval: {
    staffId: string
    userId: string
    bindingId: string
    pinVersion: number
    reasonCode: string
    note?: string | null
    occurredAt: string
  }
  lines: RefundLinePayload[]
  tenders: RefundTenderPayload[]
  refundedMinor: number
  occurredAt: string
}

/** An electronic tender written `PENDING` for the post-commit dispatch (P13-D26). */
export interface RefundPendingTender {
  refundTenderId: string
  saleTenderId: string
  paymentId: string
  amountMinor: number
}

export interface RefundApplyResult {
  refundId: string
  number: string
  refundedMinor: number
  pendingDispatch: RefundPendingTender[]
}

export type UploadItemStatus = 'APPLIED' | 'REPLAYED' | 'REJECTED'

export interface UploadItemResult {
  clientTransactionId: string
  status: UploadItemStatus
  serverId: string | null
  conflicts: Array<{ id: string; type: string; severity: string }>
  resolved: { customerId?: string; saleId?: string; shiftId?: string; refundId?: string }
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
  resolved: { customerId?: string; saleId?: string; shiftId?: string; refundId?: string }
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
