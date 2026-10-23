import { useQuery } from '@powersync/react'
import { useMemo } from 'react'
import type { PosConfigSnapshot } from './api/types'

/**
 * Local runtime facts the selling screens need: the cached terminal config,
 * the branch/terminal identity, and the open shift (Plan 06 Task 1).
 *
 * Everything reads from the encrypted local database, so the sell screen works
 * identically online and offline. The config snapshot comes from
 * `POST /api/pos/session`; the identity is cached beside it so the header still
 * names the terminal before the first successful sync after a restart.
 */

export interface PosIdentityRow {
  deviceId: string
  terminalId: string
  terminalCode: string
  branchId: string
  branchCode: string
  branchName: string
}

export interface OpenShiftSummary {
  id: string
  number: string
  openedAt: string
  openingFloatMinor: number
  cashierUserId: string
  cashierStaffId: string
}

interface ConfigQueryRow {
  device_id: string
  terminal_id: string
  terminal_code: string
  branch_id: string
  branch_code: string
  branch_name: string
  config_json: string | null
}

interface ShiftQueryRow {
  id: string
  number: string
  opened_at: string
  opening_float_minor: number
  cashier_user_id: string
  cashier_staff_id: string
}

/** A corrupt snapshot is treated as "no config" rather than crashing the till. */
export function parseConfigSnapshot(json: string | null | undefined): PosConfigSnapshot | null {
  if (!json) return null
  try {
    const parsed: unknown = JSON.parse(json)
    if (!parsed || typeof parsed !== 'object') return null
    const candidate = parsed as Partial<PosConfigSnapshot>
    if (candidate.taxMode !== 'INCLUSIVE' && candidate.taxMode !== 'EXCLUSIVE') return null
    if (!candidate.pos || !candidate.loyalty) return null
    return parsed as PosConfigSnapshot
  } catch {
    return null
  }
}

/**
 * Stable SQL: the open shift on **this** terminal, joined through the singleton
 * config row, so the device can never see another terminal's shift.
 */
const OPEN_SHIFT_SQL = `
  SELECT s.id, s.number, s.opened_at, s.opening_float_minor, s.cashier_user_id, s.cashier_staff_id
    FROM shift s
   WHERE s.status = 'OPEN'
     AND s.terminal_id = (SELECT terminal_id FROM pos_config WHERE id = 'current')
   LIMIT 1`

export interface PosRuntime {
  status: 'loading' | 'ready'
  config: PosConfigSnapshot | null
  identity: PosIdentityRow | null
  shift: OpenShiftSummary | null
}

/**
 * Runtime readiness. Both local queries must settle before the shell decides
 * where to send the cashier: a ready config with a still-loading shift query
 * used to bounce `#pos` back to `#shift` just after opening a shift.
 */
export function runtimeStatus(input: {
  hasConfigRow: boolean
  configLoading: boolean
  shiftLoading: boolean
}): 'loading' | 'ready' {
  if (input.configLoading && !input.hasConfigRow) return 'loading'
  if (input.shiftLoading) return 'loading'
  return 'ready'
}

export function usePosRuntime(): PosRuntime {
  const local = useQuery<ConfigQueryRow>(
    `SELECT device_id, terminal_id, terminal_code, branch_id, branch_code, branch_name, config_json
       FROM pos_config WHERE id = ?`,
    ['current'],
  )
  const shift = useQuery<ShiftQueryRow>(OPEN_SHIFT_SQL)

  const row = local.data?.[0]

  const config = useMemo(() => parseConfigSnapshot(row?.config_json), [row?.config_json])

  const identity = useMemo<PosIdentityRow | null>(() => {
    if (!row) return null
    return {
      deviceId: row.device_id,
      terminalId: row.terminal_id,
      terminalCode: row.terminal_code,
      branchId: row.branch_id,
      branchCode: row.branch_code,
      branchName: row.branch_name,
    }
  }, [row])

  const shiftRow = shift.data?.[0]
  const shiftSummary = useMemo<OpenShiftSummary | null>(() => {
    if (!shiftRow) return null
    return {
      id: shiftRow.id,
      number: shiftRow.number,
      openedAt: shiftRow.opened_at,
      openingFloatMinor: shiftRow.opening_float_minor,
      cashierUserId: shiftRow.cashier_user_id,
      cashierStaffId: shiftRow.cashier_staff_id,
    }
  }, [shiftRow])

  return {
    status: runtimeStatus({
      hasConfigRow: Boolean(row),
      configLoading: Boolean(local.isLoading),
      shiftLoading: Boolean(shift.isLoading),
    }),
    config,
    identity,
    shift: shiftSummary,
  }
}
