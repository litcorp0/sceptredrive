import type { PowerSyncDatabase } from '@powersync/web'
import type { PosConfigSnapshot } from './api/types'
import { DEFAULT_LOCKOUT_POLICY, type LockoutPolicy } from './auth/pin'

/**
 * The last config snapshot from `POST /api/pos/session`. It must be readable
 * offline (PIN lockout, receipt footer) — the table is local-only and survives
 * restarts.
 */
export async function readCachedConfig(db: PowerSyncDatabase): Promise<PosConfigSnapshot | null> {
  const row = await db.getOptional<{ config_json: string }>(
    'SELECT config_json FROM pos_config WHERE id = ?',
    ['current'],
  )
  if (!row?.config_json) return null
  try {
    return JSON.parse(row.config_json) as PosConfigSnapshot
  } catch {
    return null
  }
}

export interface PosIdentity {
  deviceId: string
  terminalId: string
  terminalCode: string
  branchId: string
  branchCode: string
}

export async function readPosIdentity(db: PowerSyncDatabase): Promise<PosIdentity | null> {
  const row = await db.getOptional<{
    device_id: string
    terminal_id: string
    terminal_code: string
    branch_id: string
    branch_code: string
  }>(
    'SELECT device_id, terminal_id, terminal_code, branch_id, branch_code FROM pos_config WHERE id = ?',
    ['current'],
  )
  if (!row) return null
  return {
    deviceId: row.device_id,
    terminalId: row.terminal_id,
    terminalCode: row.terminal_code,
    branchId: row.branch_id,
    branchCode: row.branch_code,
  }
}

/** PIN lockout follows the server policy; the documented default applies before the first sync. */
export function lockoutPolicyFor(config: PosConfigSnapshot | null): LockoutPolicy {
  if (!config) return DEFAULT_LOCKOUT_POLICY
  return {
    maxAttempts: config.pos.pinMaxAttempts,
    lockMinutes: config.pos.pinLockMinutes,
  }
}
