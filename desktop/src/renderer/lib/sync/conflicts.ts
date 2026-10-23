import type { PowerSyncDatabase } from '@powersync/web'
import type { SyncClient } from '../api/sync-client'
import type { DeviceConflictItem } from '../api/types'

/**
 * Local cache of server-raised conflicts (Plan 08 Task 3).
 *
 * The server is the only source of conflicts; the device keeps a read-only copy
 * so a manager can review one offline or after a restart. Upserts are keyed by
 * the server id, so a re-fetch never duplicates a row and status changes from
 * Phase 8's resolution flow overwrite cleanly.
 */

export function conflictResolvedAt(
  conflict: Pick<DeviceConflictItem, 'status' | 'createdAt'>,
): string | null {
  return conflict.status === 'OPEN' ? null : conflict.createdAt
}

export async function refreshConflicts(db: PowerSyncDatabase, client: SyncClient): Promise<number> {
  const conflicts = await client.conflicts(null)
  if (conflicts.length === 0) return 0

  await db.writeTransaction(async (tx) => {
    for (const conflict of conflicts) {
      await tx.execute(
        `INSERT OR REPLACE INTO sync_conflict_local
           (id, server_conflict_id, sale_id, shift_id, type, severity, status, details,
            sale_receipt_number, shift_number, created_at, resolved_at)
         VALUES (?, ?,
                 (SELECT id FROM sale WHERE receipt_number = ?),
                 (SELECT id FROM shift WHERE number = ?),
                 ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          conflict.id,
          conflict.id,
          conflict.saleReceiptNumber,
          conflict.shiftNumber,
          conflict.type,
          conflict.severity,
          conflict.status,
          JSON.stringify(conflict.details ?? {}),
          conflict.saleReceiptNumber,
          conflict.shiftNumber,
          conflict.createdAt,
          conflictResolvedAt(conflict),
        ],
      )
    }
  })

  return conflicts.length
}
