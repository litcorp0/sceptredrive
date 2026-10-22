import type { TaxMode } from '@gikautos/shared'

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
