import { type DbExecutor, db } from '@sceptre/db'
import { and, eq } from 'drizzle-orm'
import { env } from '../../config/env.ts'
import { AppError } from '../../http/errors.ts'
import { enqueueEvatSubmission, enqueueRefundDispatch } from '../../jobs/queues.ts'
import { logger } from '../../logger.ts'
import * as evatService from '../evat/evat.service.ts'
import { hashDeviceToken } from '../org/enrollment.service.ts'
import * as settingsService from '../platform/settings.service.ts'
import { addConflict } from '../pos/pos.conflicts.ts'
import {
  countOpenConflicts,
  selectConflictsForTerminal,
  selectLastSaleAt,
  selectSettingsVersion,
} from '../pos/pos.repository.ts'
import { posSyncTransaction } from '../pos/pos.schema.ts'
import {
  applyCartVoid,
  applyRefund,
  applyRepayment,
  applySale,
  closeShift,
  openShift,
  recordCashMovement,
  type ShiftCloseWithCloser,
} from '../pos/pos.service.ts'
import type { CashMovementPayload, SalePayload, ShiftOpenPayload } from '../pos/pos.types.ts'
import { signDeviceJwt, signPowersyncJwt } from './sync.jwt.ts'
import type { DeviceSessionRow } from './sync.repository.ts'
import { findSessionByDeviceId, findSessionByTokenHash } from './sync.repository.ts'
import type {
  CartVoidPayload,
  CreditRepaymentPayload,
  DeviceAuthContext,
  DeviceConflictItem,
  DeviceSyncState,
  PosConfigSnapshot,
  PosLoyaltyConfig,
  PosRuntimeConfig,
  PosSessionPayload,
  PosUploadBody,
  PosUploadResponse,
  PowersyncTokenPayload,
  RefundPayload,
  StoredTransactionResult,
  UploadItemResult,
  UploadItemStatus,
  UploadTransaction,
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

// --- Upload and device sync reads (Plan 05) ---------------------------------

/**
 * A side effect that must not run inside the upload transaction: an HTTP call to
 * the provider cannot be rolled back, so it is enqueued after the commit and a
 * failure to enqueue is logged rather than thrown — the 15-minute sweep is the
 * backstop (P13-D26).
 */
type PostCommitHook = () => Promise<void>

/**
 * Runs every hook even when one rejects: a lost refund dispatch must not also
 * swallow the submission doorbell. Both are backed by a database sweep, so the
 * throw is logged once by the caller and nothing is lost with it.
 */
async function runPostCommitHooks(hooks: readonly PostCommitHook[]): Promise<void> {
  const results = await Promise.allSettled(hooks.map((hook) => hook()))
  const failed = results.find((result) => result.status === 'rejected')
  if (failed) throw failed.reason
}

interface DispatchOutcome {
  stored: StoredTransactionResult
  postCommit?: PostCommitHook
}

export interface UploadOptions {
  /**
   * Where a refund's dispatch goes. Production uses pg-boss; a test substitutes
   * its own collector, which is also how the post-commit ordering is proven.
   */
  enqueueRefund?: (refundId: string) => Promise<void>
  /**
   * Where a submission's doorbell goes. The row is already written in the
   * transaction above; this only wakes the worker early (P14-D40).
   */
  enqueueEvat?: (submissionId: string) => Promise<void>
}

/**
 * Applies a batch in array order, one DB transaction per client transaction.
 * Business conflicts are part of a 200 response; 401/403 are auth/scope only,
 * and unexpected failures bubble as 5xx so the client retries.
 */
export async function applyUpload(
  auth: DeviceAuthContext,
  body: PosUploadBody,
  options: UploadOptions = {},
): Promise<PosUploadResponse> {
  if (body.deviceId !== auth.deviceId || body.terminalId !== auth.terminalId) {
    throw new AppError(403, 'DEVICE_MISMATCH', 'This batch does not belong to this device')
  }

  const clockSkewToleranceMinutes = await settingsService.getSettingValue(
    'pos.clockSkewToleranceMinutes',
  )
  const results: UploadItemResult[] = []
  for (const transaction of body.transactions) {
    results.push(await applyTransaction(auth, transaction, clockSkewToleranceMinutes, options))
  }

  return {
    batchId: body.batchId,
    serverTime: new Date().toISOString(),
    results,
  }
}

async function reserveTransaction(
  tx: DbExecutor,
  auth: DeviceAuthContext,
  item: UploadTransaction,
): Promise<string | null> {
  const rows = await tx
    .insert(posSyncTransaction)
    .values({
      terminalId: auth.terminalId,
      deviceId: auth.deviceId,
      clientTransactionId: item.clientTransactionId,
      type: item.type,
      status: 'APPLIED',
      result: {},
      conflictCount: 0,
      occurredAt: new Date(item.occurredAt),
    })
    .onConflictDoNothing({
      target: [posSyncTransaction.terminalId, posSyncTransaction.clientTransactionId],
    })
    .returning({ id: posSyncTransaction.id })
  return rows[0]?.id ?? null
}

async function readStoredResult(
  tx: DbExecutor,
  auth: DeviceAuthContext,
  item: UploadTransaction,
): Promise<StoredTransactionResult> {
  const rows = await tx
    .select({ result: posSyncTransaction.result })
    .from(posSyncTransaction)
    .where(
      and(
        eq(posSyncTransaction.terminalId, auth.terminalId),
        eq(posSyncTransaction.clientTransactionId, item.clientTransactionId),
      ),
    )
    .limit(1)
  const stored = rows[0]?.result as StoredTransactionResult | undefined
  if (!stored?.status) {
    throw new AppError(500, 'INTERNAL', 'A reserved transaction has no stored result')
  }
  return stored
}

async function finishTransaction(
  tx: DbExecutor,
  reservationId: string,
  stored: StoredTransactionResult,
): Promise<void> {
  await tx
    .update(posSyncTransaction)
    .set({
      status: stored.status,
      result: stored,
      conflictCount: stored.conflicts.length,
      appliedAt: new Date(),
    })
    .where(eq(posSyncTransaction.id, reservationId))
}

function toItemResult(
  clientTransactionId: string,
  status: UploadItemStatus,
  stored: StoredTransactionResult,
): UploadItemResult {
  return {
    clientTransactionId,
    status,
    serverId: stored.serverId,
    conflicts: stored.conflicts,
    resolved: stored.resolved,
    ...(stored.error ? { error: stored.error } : {}),
  }
}

async function dispatchTransaction(
  tx: DbExecutor,
  auth: DeviceAuthContext,
  item: UploadTransaction,
  receivedAt: Date,
  clockSkewToleranceMinutes: number,
  options: UploadOptions,
): Promise<DispatchOutcome> {
  switch (item.type) {
    case 'SALE': {
      const result = await applySale(
        {
          clientTransactionId: item.clientTransactionId,
          device: auth,
          receivedAt,
          clockSkewToleranceMinutes,
        },
        item.payload as SalePayload,
        tx,
      )
      // Inside the same transaction as the sale: a committed sale without its
      // submission row would be a document no sweep could ever find.
      const submissionId = await evatService.queueForSale(result.saleId, tx)
      const enqueueEvat = options.enqueueEvat ?? enqueueEvatSubmission
      return {
        stored: {
          status: 'APPLIED',
          serverId: result.saleId,
          conflicts: result.conflicts,
          resolved: {
            saleId: result.saleId,
            ...(result.resolvedCustomerId ? { customerId: result.resolvedCustomerId } : {}),
          },
        },
        ...(submissionId ? { postCommit: () => enqueueEvat(submissionId) } : {}),
      }
    }
    case 'REFUND': {
      const payload = item.payload as RefundPayload
      const result = await applyRefund(
        {
          clientTransactionId: item.clientTransactionId,
          device: auth,
          receivedAt,
          clockSkewToleranceMinutes,
        },
        payload,
        tx,
      )
      const submissionId = await evatService.queueForRefund(result.refundId, tx)
      const enqueue = options.enqueueRefund ?? enqueueRefundDispatch
      const enqueueEvat = options.enqueueEvat ?? enqueueEvatSubmission
      const hooks: PostCommitHook[] = []
      // Only an electronic tender needs the provider; a cash-and-credit refund
      // is settled by the time this transaction commits.
      if (result.pendingDispatch.length > 0) hooks.push(() => enqueue(result.refundId))
      if (submissionId) hooks.push(() => enqueueEvat(submissionId))
      return {
        stored: {
          status: 'APPLIED',
          serverId: result.refundId,
          conflicts: [],
          resolved: { refundId: result.refundId, saleId: payload.saleId },
        },
        ...(hooks.length > 0 ? { postCommit: () => runPostCommitHooks(hooks) } : {}),
      }
    }
    case 'SHIFT_OPEN': {
      const result = await openShift(auth, item.payload as ShiftOpenPayload, tx)
      return {
        stored: {
          status: 'APPLIED',
          serverId: result.shiftId,
          conflicts: [],
          resolved: { shiftId: result.shiftId },
        },
      }
    }
    case 'CASH_MOVEMENT': {
      const result = await recordCashMovement(auth, item.payload as CashMovementPayload, tx)
      return {
        stored: {
          status: 'APPLIED',
          serverId: (item.payload as CashMovementPayload).id,
          conflicts: [],
          resolved: { shiftId: result.shiftId },
        },
      }
    }
    case 'SHIFT_CLOSE': {
      const result = await closeShift(auth, item.payload as ShiftCloseWithCloser, tx)
      return {
        stored: {
          status: 'APPLIED',
          serverId: result.shiftId,
          conflicts: result.conflictId
            ? [
                {
                  id: result.conflictId,
                  type: 'SHIFT_VARIANCE_MISMATCH',
                  severity: 'MEDIUM',
                },
              ]
            : [],
          resolved: { shiftId: result.shiftId },
        },
      }
    }
    case 'CREDIT_REPAYMENT': {
      const result = await applyRepayment(
        {
          clientTransactionId: item.clientTransactionId,
          device: auth,
          receivedAt,
          clockSkewToleranceMinutes,
        },
        item.payload as CreditRepaymentPayload,
        tx,
      )
      return {
        stored: {
          status: 'APPLIED',
          serverId: result.repaymentId,
          conflicts: [],
          resolved: { repaymentId: result.repaymentId },
        },
      }
    }
    case 'CART_VOID': {
      const result = await applyCartVoid(
        {
          clientTransactionId: item.clientTransactionId,
          device: auth,
          receivedAt,
          clockSkewToleranceMinutes,
        },
        item.payload as CartVoidPayload,
        tx,
      )
      return {
        stored: {
          status: 'APPLIED',
          serverId: result.cartVoidId,
          conflicts: [],
          resolved: { cartVoidId: result.cartVoidId },
        },
      }
    }
  }
}

/**
 * One client transaction: reserve, apply, and finalise in one transaction. A
 * rejection rolls the domain work back and records a committed REJECTED
 * reservation in a second transaction so a retry never re-applies it.
 */
async function applyTransaction(
  auth: DeviceAuthContext,
  item: UploadTransaction,
  clockSkewToleranceMinutes: number,
  options: UploadOptions,
): Promise<UploadItemResult> {
  const receivedAt = new Date()

  try {
    const outcome = await db.transaction(async (tx) => {
      const reservationId = await reserveTransaction(tx, auth, item)
      if (!reservationId) {
        return {
          replayed: true as const,
          stored: await readStoredResult(tx, auth, item),
          postCommit: undefined,
        }
      }
      const dispatched = await dispatchTransaction(
        tx,
        auth,
        item,
        receivedAt,
        clockSkewToleranceMinutes,
        options,
      )
      await finishTransaction(tx, reservationId, dispatched.stored)
      return { replayed: false as const, ...dispatched }
    })

    // After the commit, never inside it: the provider call cannot be rolled back
    // with the document, and a lost enqueue is the sweep's job, not the till's
    // error (P13-D26).
    if (outcome.postCommit) {
      try {
        await outcome.postCommit()
      } catch (error) {
        logger.error(
          { err: error, clientTransactionId: item.clientTransactionId, type: item.type },
          'failed to enqueue a post-commit job; the sweep will pick it up',
        )
      }
    }

    return toItemResult(
      item.clientTransactionId,
      outcome.replayed ? 'REPLAYED' : 'APPLIED',
      outcome.stored,
    )
  } catch (error) {
    if (!(error instanceof AppError) || error.statusCode >= 500) throw error

    const outcome = await db.transaction(async (tx) => {
      const reservationId = await reserveTransaction(tx, auth, item)
      if (!reservationId) {
        return { replayed: true as const, stored: await readStoredResult(tx, auth, item) }
      }

      const conflicts: StoredTransactionResult['conflicts'] = []
      if (error.code === 'UNKNOWN_PRODUCT') {
        // The sale row was rolled back with the rejection, so the conflict
        // cannot reference it; the client transaction id in details is the link.
        const conflict = await addConflict(
          tx,
          { device: auth, saleId: null },
          {
            type: 'UNKNOWN_PRODUCT',
            severity: 'HIGH',
            details: {
              clientTransactionId: item.clientTransactionId,
              productIds: Array.isArray(error.details?.productIds) ? error.details.productIds : [],
            },
          },
        )
        conflicts.push(conflict)
      }

      const stored: StoredTransactionResult = {
        status: 'REJECTED',
        serverId: null,
        conflicts,
        resolved: {},
        error: { code: error.code, message: error.message },
      }
      await finishTransaction(tx, reservationId, stored)
      return { replayed: false as const, stored }
    })

    return toItemResult(
      item.clientTransactionId,
      outcome.replayed ? 'REPLAYED' : 'REJECTED',
      outcome.stored,
    )
  }
}

/** Conflicts for this device's terminal, newest first. */
export async function listDeviceConflicts(
  auth: DeviceAuthContext,
  query: { since?: string | undefined; limit: number },
): Promise<{ conflicts: DeviceConflictItem[] }> {
  const since = query.since ? new Date(query.since) : null
  if (since && Number.isNaN(since.getTime())) {
    throw new AppError(400, 'INVALID_TIMESTAMP', 'since must be an ISO timestamp')
  }

  const rows = await selectConflictsForTerminal(auth.terminalId, since, query.limit)
  return {
    conflicts: rows.map((row) => ({
      id: row.id,
      type: row.type,
      severity: row.severity,
      status: row.status,
      saleReceiptNumber: row.saleReceiptNumber,
      shiftNumber: row.shiftNumber,
      details: (row.details ?? {}) as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
    })),
  }
}

/** Cheap polling fallback for the POS status panel. */
export async function getDeviceSyncState(auth: DeviceAuthContext): Promise<DeviceSyncState> {
  const [pendingConflicts, lastSaleAt, configVersion] = await Promise.all([
    countOpenConflicts(auth.terminalId),
    selectLastSaleAt(auth.terminalId),
    selectSettingsVersion(),
  ])

  return {
    pendingConflicts,
    lastSaleAt: lastSaleAt?.toISOString() ?? null,
    serverTime: new Date().toISOString(),
    configVersion,
  }
}
