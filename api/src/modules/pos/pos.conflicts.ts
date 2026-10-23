import type { DbExecutor } from '@gikautos/db'
import type { DeviceAuthContext } from '../sync/sync.types.ts'
import { insertConflict } from './pos.repository.ts'
import type { AppliedConflict, SyncConflictSeverity, SyncConflictType } from './pos.types.ts'

export interface ConflictContext {
  device: DeviceAuthContext
  saleId?: string | null
  shiftId?: string | null
}

export interface ConflictInput {
  type: SyncConflictType
  severity: SyncConflictSeverity
  /** Ids and amounts only: never customer names, phones, tokens, or PIN material. */
  details: Record<string, unknown>
  saleId?: string | null
  shiftId?: string | null
}

/**
 * One helper for every business conflict (sales and shifts). A conflict is
 * information attached to an applied fact, never a reason to reject it.
 */
export async function addConflict(
  tx: DbExecutor,
  context: ConflictContext,
  input: ConflictInput,
): Promise<AppliedConflict> {
  const row = await insertConflict(
    {
      branchId: context.device.branchId,
      terminalId: context.device.terminalId,
      deviceId: context.device.deviceId,
      saleId: input.saleId ?? context.saleId ?? null,
      shiftId: input.shiftId ?? context.shiftId ?? null,
      type: input.type,
      severity: input.severity,
      status: 'OPEN',
      details: input.details,
    },
    tx,
  )

  return {
    id: row.id,
    type: row.type as SyncConflictType,
    severity: row.severity as SyncConflictSeverity,
  }
}
