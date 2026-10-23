import { describe, expect, it } from 'vitest'
import type { SyncClient } from '../api/sync-client'
import type { DeviceConflictItem } from '../api/types'
import { conflictResolvedAt, refreshConflicts } from './conflicts'

/** The local conflict cache: idempotent upserts, no duplicate rows. */

const CONFLICT: DeviceConflictItem = {
  id: 'conflict-1',
  type: 'STOCK_OVERSELL',
  severity: 'HIGH',
  status: 'OPEN',
  saleReceiptNumber: 'ACC-SPX-T01-20261023-0001',
  shiftNumber: null,
  details: { productId: 'p1', onHand: -2, requested: 3 },
  createdAt: '2026-10-23T10:05:00.000Z',
}

function client(conflicts: DeviceConflictItem[]): SyncClient {
  return {
    upload: async () => {
      throw new Error('not used')
    },
    conflicts: async () => conflicts,
    state: async () => {
      throw new Error('not used')
    },
  }
}

function fakeDb() {
  const statements: Array<{ sql: string; parameters: unknown[] | undefined }> = []
  return {
    statements,
    db: {
      writeTransaction: async <T>(
        work: (tx: {
          execute: (sql: string, parameters?: unknown[]) => Promise<void>
        }) => Promise<T>,
      ) =>
        work({
          execute: async (sql: string, parameters?: unknown[]) => {
            statements.push({ sql, parameters })
          },
        }),
    } as never,
  }
}

describe('refreshConflicts', () => {
  it('upserts by server id and links the local receipt', async () => {
    const { db, statements } = fakeDb()
    const count = await refreshConflicts(db, client([CONFLICT]))

    expect(count).toBe(1)
    expect(statements).toHaveLength(1)
    const insert = statements[0]
    expect(insert?.sql).toContain('INSERT OR REPLACE INTO sync_conflict_local')
    expect(insert?.sql).toContain('SELECT id FROM sale WHERE receipt_number = ?')
    const parameters = insert?.parameters ?? []
    expect(parameters[0]).toBe('conflict-1')
    expect(parameters[2]).toBe(CONFLICT.saleReceiptNumber)
    expect(parameters[3]).toBeNull()
    expect(parameters[4]).toBe('STOCK_OVERSELL')
    expect(parameters[5]).toBe('HIGH')
    expect(parameters[6]).toBe('OPEN')
    expect(JSON.parse(String(parameters[7]))).toEqual(CONFLICT.details)
    expect(parameters[11]).toBeNull()
  })

  it('does nothing when the server has no conflicts', async () => {
    const { db, statements } = fakeDb()
    await expect(refreshConflicts(db, client([]))).resolves.toBe(0)
    expect(statements).toHaveLength(0)
  })

  it('keeps a resolved timestamp for a non-open conflict', () => {
    expect(conflictResolvedAt({ ...CONFLICT, status: 'OPEN' })).toBeNull()
    expect(conflictResolvedAt({ ...CONFLICT, status: 'RESOLVED' })).toBe(CONFLICT.createdAt)
  })
})
