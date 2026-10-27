import { describe, expect, it } from 'vitest'
import type { UploadItemResult } from '../api/types'
import { createOutboxStore } from './outbox-repository'
import type { OutboxRow } from './outbox-types'

/**
 * SQL-level behaviour of the outbox store: state transitions, delta
 * acknowledgement, customer-draft linking, and pruning. The uploader tests use
 * an in-memory store; these pin the actual statements the device executes.
 */

interface Statement {
  sql: string
  parameters: unknown[] | undefined
}

function fakeDb(
  handler: {
    getOptional?: (sql: string, parameters?: unknown[]) => Promise<unknown>
    getAll?: (sql: string, parameters?: unknown[]) => Promise<unknown[]>
  } = {},
) {
  const statements: Statement[] = []
  const execute = async (sql: string, parameters?: unknown[]) => {
    statements.push({ sql, parameters })
  }
  const db = {
    execute,
    getOptional: async (sql: string, parameters?: unknown[]) => {
      statements.push({ sql, parameters })
      return handler.getOptional ? handler.getOptional(sql, parameters) : null
    },
    getAll: async (sql: string, parameters?: unknown[]) => {
      statements.push({ sql, parameters })
      return handler.getAll ? handler.getAll(sql, parameters) : []
    },
    writeTransaction: async <T>(
      work: (tx: {
        execute: typeof execute
        getAll: (sql: string, params?: unknown[]) => Promise<unknown[]>
        getOptional: (sql: string, params?: unknown[]) => Promise<unknown>
      }) => Promise<T>,
    ) =>
      work({
        execute,
        getOptional: async (sql: string, parameters?: unknown[]) => {
          statements.push({ sql, parameters })
          return handler.getOptional ? handler.getOptional(sql, parameters) : null
        },
        getAll: async (sql: string, parameters?: unknown[]) => {
          statements.push({ sql, parameters })
          return handler.getAll ? handler.getAll(sql, parameters) : []
        },
      }),
  }
  return { db: db as never, statements }
}

const ROW: OutboxRow = {
  id: 'sale-1',
  clientTransactionId: 'sale-1',
  type: 'SALE',
  occurredAt: '2026-10-23T10:00:00.000Z',
  payloadVersion: 1,
  payload: { customer: { id: 'draft-customer' } },
  status: 'in_flight',
  attempts: 0,
  nextAttemptAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  serverResult: null,
  ackedAt: null,
  createdAt: '2026-10-23T10:00:00.000Z',
  updatedAt: '2026-10-23T10:00:00.000Z',
}

const APPLIED: UploadItemResult = {
  clientTransactionId: 'sale-1',
  status: 'APPLIED',
  serverId: 'server-sale-1',
  conflicts: [],
  resolved: { saleId: 'sale-1', customerId: 'real-customer' },
}

const REFUND_ROW: OutboxRow = {
  ...ROW,
  id: 'refund-1',
  clientTransactionId: 'refund-1',
  type: 'REFUND',
  payload: { saleId: 'sale-1' },
}

const REPAYMENT_ROW: OutboxRow = {
  ...ROW,
  id: 'repayment-1',
  clientTransactionId: 'repayment-1',
  type: 'CREDIT_REPAYMENT',
  payload: { customerId: 'customer-1' },
}

/** A result for a row that is not a sale and resolves nothing. */
function appliedFor(id: string): UploadItemResult {
  return { clientTransactionId: id, status: 'APPLIED', serverId: id, conflicts: [], resolved: {} }
}

const DB_ROW = {
  id: 'sale-1',
  client_transaction_id: 'sale-1',
  type: 'SALE',
  occurred_at: '2026-10-23T10:00:00.000Z',
  payload_version: 1,
  payload: '{"customer":{"id":"draft-customer"}}',
  status: 'pending',
  attempts: 0,
  next_attempt_at: null,
  last_error: null,
  last_error_code: null,
  last_error_message: null,
  server_result: null,
  acked_at: null,
  created_at: '2026-10-23T09:00:00.000Z',
  updated_at: '2026-10-23T09:00:00.000Z',
  receipt_number: 'ACC-SPX-T01-20261023-0001',
}

describe('nextBatch', () => {
  it('claims the oldest due rows and marks them in_flight', async () => {
    const { db, statements } = fakeDb({ getAll: async () => [DB_ROW] })
    const store = createOutboxStore(db)

    const rows = await store.nextBatch(25, '2026-10-23T10:00:00.000Z')

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'sale-1',
      status: 'pending',
      payload: { customer: { id: 'draft-customer' } },
      receiptNumber: 'ACC-SPX-T01-20261023-0001',
    })
    const select = statements.find((statement) => statement.sql.includes('FROM outbox'))
    expect(select?.sql).toContain('ORDER BY created_at ASC, id ASC')
    expect(select?.sql).toContain('next_attempt_at IS NULL OR next_attempt_at <= ?')
    expect(select?.parameters).toEqual(['2026-10-23T10:00:00.000Z', 25])
    expect(statements.some((statement) => statement.sql.includes("status = 'in_flight'"))).toBe(
      true,
    )
  })

  it('dead-letters a stored type this build cannot upload instead of calling it a sale', async () => {
    const { db, statements } = fakeDb({
      getAll: async () => [{ ...DB_ROW, type: 'REFUND_V2' }],
    })
    const store = createOutboxStore(db)

    // A closed wire union cannot dispatch an unknown type: it must not be handed
    // to the uploader dressed as a SALE (the old behaviour), and it must not be
    // left pending to retry forever.
    await expect(store.nextBatch(25, '2026-10-23T10:00:00.000Z')).resolves.toEqual([])

    const sql = statements.map((statement) => statement.sql)
    expect(sql.some((text) => text.includes("status = 'in_flight'"))).toBe(false)
    const dead = statements.find((statement) => statement.sql.includes("status = 'dead_letter'"))
    expect(dead?.parameters?.[0]).toBe('UNKNOWN_OUTBOX_TYPE')
    expect(String(dead?.parameters?.[1])).toContain('REFUND_V2')
  })
})

describe('markAcked', () => {
  it('acks the row, its pending deltas, and links a resolved customer draft', async () => {
    const { db, statements } = fakeDb()
    const store = createOutboxStore(db)

    await store.markAcked(ROW, APPLIED, '2026-10-23T10:01:00.000Z')

    const sql = statements.map((statement) => statement.sql)
    expect(sql.some((text) => text.includes("status = 'acked'"))).toBe(true)
    expect(sql.filter((text) => text.includes('SET acked_at = ?')).length).toBe(3)
    expect(sql.some((text) => text.includes('UPDATE customer_draft'))).toBe(true)
    expect(sql.some((text) => text.includes('UPDATE sale SET customer_id'))).toBe(true)
    expect(sql.some((text) => text.includes('UPDATE local_credit_delta SET customer_id'))).toBe(
      true,
    )
    expect(sql.some((text) => text.includes('UPDATE local_loyalty_delta SET customer_id'))).toBe(
      true,
    )

    const ack = statements.find((statement) => statement.sql.includes("status = 'acked'"))
    expect(ack?.parameters?.[0]).toBe('2026-10-23T10:01:00.000Z')
    expect(JSON.parse(String(ack?.parameters?.[1]))).toMatchObject({ status: 'APPLIED' })
  })

  it('does not rewrite the customer when the server kept the same id', async () => {
    const { db, statements } = fakeDb()
    const store = createOutboxStore(db)
    await store.markAcked(
      ROW,
      { ...APPLIED, resolved: { customerId: 'draft-customer' } },
      '2026-10-23T10:01:00.000Z',
    )
    expect(statements.some((statement) => statement.sql.includes('UPDATE customer_draft'))).toBe(
      false,
    )
  })

  it('acks a refund’s stock deltas and touches no other ledger', async () => {
    const { db, statements } = fakeDb()
    const store = createOutboxStore(db)

    await store.markAcked(REFUND_ROW, appliedFor('refund-1'), '2026-10-27T10:20:00.000Z')

    const deltas = statements.filter((statement) => statement.sql.includes('SET acked_at = ?'))
    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.sql).toContain('UPDATE local_stock_delta')
    expect(deltas[0]?.parameters).toEqual(['2026-10-27T10:20:00.000Z', 'refund-1'])
  })

  it('acks a repayment’s credit delta and touches no stock', async () => {
    const { db, statements } = fakeDb()
    const store = createOutboxStore(db)

    await store.markAcked(REPAYMENT_ROW, appliedFor('repayment-1'), '2026-10-27T10:25:00.000Z')

    const deltas = statements.filter((statement) => statement.sql.includes('SET acked_at = ?'))
    expect(deltas).toHaveLength(1)
    expect(deltas[0]?.sql).toContain('UPDATE local_credit_delta')
    expect(deltas[0]?.parameters).toEqual(['2026-10-27T10:25:00.000Z', 'repayment-1'])
  })

  /**
   * A replay can ack the same row twice (a crash between the write and the
   * response). The delta arm sets an absolute timestamp under
   * `acked_at IS NULL`, so the second ack changes nothing and cannot move the
   * first ack time.
   */
  it('changes nothing when the same refund is acked a second time', async () => {
    const acked = new Map<string, string>()
    const statements: Statement[] = []
    const execute = async (sql: string, parameters?: unknown[]) => {
      statements.push({ sql, parameters })
      if (!sql.includes('SET acked_at = ?')) return
      if (!sql.includes('AND acked_at IS NULL')) throw new Error('delta ack is not idempotent')
      const [at, id] = parameters as [string, string]
      if (!acked.has(id)) acked.set(id, at)
    }
    const db = {
      execute,
      getOptional: async () => null,
      getAll: async () => [],
      writeTransaction: async <T>(work: (tx: { execute: typeof execute }) => Promise<T>) =>
        work({ execute }),
    } as never

    const store = createOutboxStore(db)
    await store.markAcked(REFUND_ROW, appliedFor('refund-1'), '2026-10-27T10:20:00.000Z')
    await store.markAcked(REFUND_ROW, appliedFor('refund-1'), '2026-10-27T11:00:00.000Z')

    expect(acked.get('refund-1')).toBe('2026-10-27T10:20:00.000Z')
    expect(
      statements.filter((statement) => statement.sql.includes('UPDATE local_stock_delta')),
    ).toHaveLength(2)
  })
})

describe('failure transitions', () => {
  it('dead-letters a rejected row without acknowledging its deltas', async () => {
    const { db, statements } = fakeDb()
    const store = createOutboxStore(db)

    await store.markRejected(
      ROW,
      {
        clientTransactionId: 'sale-1',
        status: 'REJECTED',
        serverId: null,
        conflicts: [],
        resolved: {},
        error: { code: 'UNKNOWN_PRODUCT', message: 'The product no longer exists' },
      },
      '2026-10-23T10:01:00.000Z',
    )

    const sql = statements.map((statement) => statement.sql)
    expect(sql.some((text) => text.includes("status = 'dead_letter'"))).toBe(true)
    expect(sql.some((text) => text.includes('UPDATE local_'))).toBe(false)
    const update = statements.find((statement) => statement.sql.includes('dead_letter'))
    expect(update?.parameters?.slice(1, 3)).toEqual([
      'UNKNOWN_PRODUCT',
      'The product no longer exists',
    ])
  })

  it('increments attempts and stores the next attempt on backoff', async () => {
    const { db, statements } = fakeDb()
    const store = createOutboxStore(db)

    await store.backoffRows([ROW], 1_500, 'SERVER_ERROR', 'try later', '2026-10-23T10:00:00.000Z')

    const update = statements.find((statement) => statement.sql.includes('attempts = attempts + 1'))
    expect(update?.parameters?.[0]).toBe('2026-10-23T10:00:01.500Z')
    expect(update?.parameters?.[1]).toBe('SERVER_ERROR')
    expect(update?.sql).toContain("status = 'pending'")
  })

  it('releases rows without a backoff for auth/ambiguity', async () => {
    const { db, statements } = fakeDb()
    const store = createOutboxStore(db)
    await store.releaseRows([ROW], '2026-10-23T10:00:00.000Z')
    const update = statements.find((statement) => statement.sql.includes('next_attempt_at = NULL'))
    expect(update?.sql).toContain("status = 'pending'")
  })

  it('resets a dead letter for a manager retry', async () => {
    const { db, statements } = fakeDb()
    const store = createOutboxStore(db)
    await store.retryDeadLetter('sale-1', '2026-10-23T10:00:00.000Z')
    const update = statements[0]
    expect(update?.sql).toContain("status = 'pending'")
    expect(update?.sql).toContain('attempts = 0')
    expect(update?.sql).toContain("status = 'dead_letter'")
  })
})

describe('maintenance and status', () => {
  it('resets in_flight rows after a crash', async () => {
    const { db, statements } = fakeDb({
      getOptional: async () => ({ count: 2 }),
    })
    const store = createOutboxStore(db)
    const reset = await store.resetInFlight('2026-10-23T10:00:00.000Z')
    expect(reset).toBe(2)
    expect(statements.some((statement) => statement.sql.includes("status = 'pending'"))).toBe(true)
    expect(statements.some((statement) => statement.sql.includes('next_attempt_at = NULL'))).toBe(
      true,
    )
  })

  it('reads aggregate counts', async () => {
    const { db } = fakeDb({
      getOptional: async () => ({ pending: 4, dead_letters: 1, conflicts: 0 }),
    })
    const store = createOutboxStore(db)
    await expect(store.counts()).resolves.toEqual({ pending: 4, deadLetters: 1, conflicts: 0 })
  })

  it('prunes only acked rows older than the cutoff', async () => {
    const { db, statements } = fakeDb({ getOptional: async () => ({ count: 3 }) })
    const store = createOutboxStore(db)
    const pruned = await store.pruneAcked('2026-09-23T00:00:00.000Z')
    expect(pruned).toBe(3)
    const del = statements.find((statement) => statement.sql.startsWith('DELETE FROM outbox'))
    expect(del?.sql).toContain("status = 'acked'")
    expect(del?.parameters?.[0]).toBe('2026-09-23T00:00:00.000Z')
  })

  it('lists recent rows with the joined receipt number', async () => {
    const { db, statements } = fakeDb({ getAll: async () => [DB_ROW] })
    const store = createOutboxStore(db)
    const rows = await store.listRecent(100)

    expect(rows[0]?.receiptNumber).toBe('ACC-SPX-T01-20261023-0001')
    expect(statements[0]?.sql).toContain('o.id')
    expect(statements[0]?.sql).toContain('LEFT JOIN sale s ON s.id = o.id')
  })

  it('persists and reads the last successful upload timestamp', async () => {
    const { db, statements } = fakeDb({
      getOptional: async () => ({ value: '2026-10-23T10:00:00.000Z' }),
    })
    const store = createOutboxStore(db)
    await expect(store.readLastSuccessAt()).resolves.toBe('2026-10-23T10:00:00.000Z')

    await store.writeLastSuccessAt('2026-10-23T10:05:00.000Z')
    const insert = statements.find((statement) =>
      statement.sql.includes('INSERT OR REPLACE INTO device_setting'),
    )
    expect(insert?.parameters?.[0]).toBe('2026-10-23T10:05:00.000Z')
  })
})
