import { env } from '../../config/env.ts'
import { AppError } from '../../http/errors.ts'
import { hashDeviceToken } from '../org/enrollment.service.ts'
import * as settingsService from '../platform/settings.service.ts'
import { signDeviceJwt, signPowersyncJwt } from './sync.jwt.ts'
import type { DeviceSessionRow } from './sync.repository.ts'
import { findSessionByDeviceId, findSessionByTokenHash } from './sync.repository.ts'
import type {
  DeviceAuthContext,
  PosConfigSnapshot,
  PosLoyaltyConfig,
  PosRuntimeConfig,
  PosSessionPayload,
  PowersyncTokenPayload,
} from './sync.types.ts'

const SERVER_TIME_ZONE = 'Africa/Accra'

/**
 * A terminal is usable only while the whole chain is live: an active device on
 * an active terminal in an active retail branch. Warehouses never host a POS.
 */
export function assertTerminalUsable(session: DeviceSessionRow): void {
  if (session.device.status !== 'ACTIVE') {
    throw new AppError(403, 'DEVICE_REVOKED', 'This device has been revoked')
  }
  if (!session.terminal.isActive) {
    throw new AppError(403, 'TERMINAL_INACTIVE', 'This terminal is not active')
  }
  if (!session.branch.isActive) {
    throw new AppError(403, 'BRANCH_INACTIVE', 'This branch is not active')
  }
  if (session.branch.type !== 'RETAIL') {
    throw new AppError(403, 'BRANCH_NOT_RETAIL', 'A warehouse branch cannot host a POS terminal')
  }
}

/** The device's offline policy snapshot. One query per setting, in parallel. */
export async function buildConfigSnapshot(branchId: string): Promise<PosConfigSnapshot> {
  const [
    taxMode,
    earnPointsPerCedi,
    pointsPerCedi,
    expiryMonths,
    minimumRedeemPoints,
    maxCashierDiscountPercent,
    maxManagerDiscountPercent,
    pinMaxAttempts,
    pinLockMinutes,
    clockSkewToleranceMinutes,
    syncBatchSize,
    receiptFooter,
    receiptHeader,
    salesRequireOpenShift,
  ] = await Promise.all([
    settingsService.getSettingValue('pricing.taxMode'),
    settingsService.getSettingValue('loyalty.earnPointsPerCedi'),
    settingsService.getSettingValue('loyalty.pointsPerCedi'),
    settingsService.getSettingValue('loyalty.expiryMonths'),
    settingsService.getSettingValue('loyalty.minimumRedeemPoints'),
    settingsService.getSettingValue('pos.maxCashierDiscountPercent'),
    settingsService.getSettingValue('pos.maxManagerDiscountPercent'),
    settingsService.getSettingValue('pos.pinMaxAttempts'),
    settingsService.getSettingValue('pos.pinLockMinutes'),
    settingsService.getSettingValue('pos.clockSkewToleranceMinutes'),
    settingsService.getSettingValue('pos.syncBatchSize'),
    settingsService.getSettingValue('pos.receiptFooter'),
    settingsService.getSettingValue('receipt.header', { branchId }),
    settingsService.getSettingValue('pos.salesRequireOpenShift'),
  ])

  const loyalty: PosLoyaltyConfig = {
    earnPointsPerCedi,
    pointsPerCedi,
    expiryMonths,
    minimumRedeemPoints,
  }
  const pos: PosRuntimeConfig = {
    maxCashierDiscountPercent,
    maxManagerDiscountPercent,
    pinMaxAttempts,
    pinLockMinutes,
    clockSkewToleranceMinutes,
    syncBatchSize,
    receiptFooter,
    salesRequireOpenShift,
  }

  return {
    taxMode,
    loyalty,
    pos,
    receiptHeader,
    serverTime: new Date().toISOString(),
    serverTimeZone: SERVER_TIME_ZONE,
  }
}

/**
 * Exchanges the long-lived device token for a short-lived device JWT plus the
 * offline configuration snapshot. This is also the refresh path: the token in
 * the keychain is the only credential the terminal holds.
 */
export async function createSession(deviceToken: string): Promise<PosSessionPayload> {
  if (!deviceToken) {
    throw new AppError(401, 'DEVICE_TOKEN_INVALID', 'Device token is invalid')
  }

  const session = await findSessionByTokenHash(hashDeviceToken(deviceToken))
  if (!session) {
    throw new AppError(401, 'DEVICE_TOKEN_INVALID', 'Device token is invalid')
  }
  assertTerminalUsable(session)

  const config = await buildConfigSnapshot(session.branch.id)
  const accessToken = await signDeviceJwt({
    deviceId: session.device.id,
    terminalId: session.terminal.id,
    branchId: session.branch.id,
  })

  return {
    deviceId: session.device.id,
    terminal: { id: session.terminal.id, code: session.terminal.code, name: session.terminal.name },
    branch: { id: session.branch.id, code: session.branch.code, name: session.branch.name },
    accessToken,
    expiresAt: new Date(Date.now() + env.POS_JWT_TTL_SECONDS * 1000).toISOString(),
    config,
  }
}

/**
 * Mints the PowerSync JWT. Its `branch_id` / `terminal_id` claims are what the
 * service's sync streams read, so they are re-read from the database rather
 * than trusted from the incoming device token.
 */
export async function issuePowersyncToken(auth: DeviceAuthContext): Promise<PowersyncTokenPayload> {
  if (!env.POWERSYNC_URL) {
    throw new AppError(
      503,
      'POWERSYNC_NOT_CONFIGURED',
      'Sync is not configured on this server (POWERSYNC_URL is unset)',
    )
  }

  const session = await findSessionByDeviceId(auth.deviceId)
  if (!session) {
    throw new AppError(403, 'DEVICE_NOT_ENROLLED', 'Device is not enrolled')
  }
  assertTerminalUsable(session)

  const audience = env.POWERSYNC_AUDIENCE ?? env.POWERSYNC_URL
  const { token, expiresAt } = await signPowersyncJwt({
    deviceId: session.device.id,
    terminalId: session.terminal.id,
    branchId: session.branch.id,
    audience,
  })

  return { endpoint: env.POWERSYNC_URL, token, expiresAt: expiresAt.toISOString() }
}
