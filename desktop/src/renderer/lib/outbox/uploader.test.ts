import { describe, expect, it, vi } from 'vitest'
import type { SyncClient } from '../api/sync-client'
import type { PosUploadRequest, PosUploadResponse, UploadItemResult } from '../api/types'
import type { UploadStatusSnapshot } from '../sync/sync-status-store'
import type { OutboxCounts, OutboxStore } from './outbox-repository'
import type { OutboxRow, OutboxStatus, OutboxType } from './outbox-types'
import { createUploader } from './uploader'

/**
 * Uploader behaviour under a controllable clock and client.
 *
 * The in-memory store implements the same contract as the SQLite store, so the
 * drain loop is exercised end to end without PowerSync (which cannot run in the
 * Node test environment).
 */

class MemoryStore implements OutboxStore {
  rows: OutboxRow[] = []
  lastSuccessAt: string | null = null
  private sequence = 0

  add(overrides: Partial<OutboxRow> & { id: string }): OutboxRow {
    const { id, ...rest } = overrides
    const at = rest.createdAt ?? new Date(2026, 9, 23, 10, 0, this.sequence).toISOString()
    this.sequence += 1
    const row: OutboxRow = {
      id,
      clientTransactionId: id,
      type: (rest.type ?? 'SALE') as OutboxType,
      occurredAt: rest.occurredAt ?? at,
      payloadVersion: 1,
      payload: rest.payload === undefined ? { receiptNumber: `R-${id}` } : rest.payload,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      serverResult: null,
      ackedAt: null,
      createdAt: at,
      updatedAt: at,
      ...rest,
    }
    this.rows.push(row)
    return row
  }

  private update(id: string, patch: Partial<OutboxRow>): void {
    const row = this.rows.find((candidate) => candidate.id === id)
    if (!row) throw new Error(`missing row ${id}`)
    Object.assign(row, patch)
  }

  async resetInFlight(): Promise<number> {
    const rows = this.rows.filter((row) => row.status === 'in_flight')
    for (const row of rows) {
      row.status = 'pending'
      row.nextAttemptAt = null
    }
    return rows.length
  }

  async nextBatch(limit: number, now: string): Promise<OutboxRow[]> {
    const due = this.rows
      .filter(
        (row) =>
          row.status === 'pending' && (row.nextAttemptAt === null || row.nextAttemptAt <= now),
      )
      .sort((left, right) =>
        left.createdAt === right.createdAt
          ? left.id.localeCompare(right.id)
          : left.createdAt.localeCompare(right.createdAt),
      )
      .slice(0, limit)
    for (const row of due) row.status = 'in_flight'
    return due.map((row) => ({ ...row }))
  }

  async markAcked(row: OutboxRow, result: UploadItemResult, now: string): Promise<void> {
    this.update(row.id, {
      status: 'acked',
      ackedAt: now,
      serverResult: result,
      lastErrorCode: null,
      lastErrorMessage: null,
      nextAttemptAt: null,
    })
  }

  async markRejected(row: OutboxRow, result: UploadItemResult, now: string): Promise<void> {
    this.update(row.id, {
      status: 'dead_letter',
      serverResult: result,
      lastErrorCode: result.error?.code ?? 'REJECTED',
      lastErrorMessage: result.error?.message ?? 'rejected',
      updatedAt: now,
    })
  }

  async deadLetterBatch(
    rows: OutboxRow[],
    code: string,
    message: string,
    now: string,
  ): Promise<void> {
    for (const row of rows) {
      this.update(row.id, {
        status: 'dead_letter',
        lastErrorCode: code,
        lastErrorMessage: message,
        updatedAt: now,
      })
    }
  }

  async backoffRows(
    rows: OutboxRow[],
    delayMs: number,
    code: string,
    message: string,
    now: string,
  ): Promise<void> {
    for (const row of rows) {
      this.update(row.id, {
        status: 'pending',
        attempts: row.attempts + 1,
        nextAttemptAt: new Date(Date.parse(now) + delayMs).toISOString(),
        lastErrorCode: code,
        lastErrorMessage: message,
        updatedAt: now,
      })
    }
  }

  async delayRows(rows: OutboxRow[], nextAttemptAt: string, now: string): Promise<void> {
    for (const row of rows) {
      this.update(row.id, { status: 'pending', nextAttemptAt, updatedAt: now })
    }
  }

  async releaseRows(rows: OutboxRow[], now: string): Promise<void> {
    for (const row of rows) {
      this.update(row.id, { status: 'pending', nextAttemptAt: null, updatedAt: now })
    }
  }

  async retryDeadLetter(id: string, now: string): Promise<void> {
    this.update(id, {
      status: 'pending',
      attempts: 0,
      nextAttemptAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      serverResult: null,
      ackedAt: null,
      updatedAt: now,
    })
  }

  async counts(): Promise<OutboxCounts> {
    return {
      pending: this.rows.filter((row) => row.status === 'pending' || row.status === 'in_flight')
        .length,
      deadLetters: this.rows.filter((row) => row.status === 'dead_letter').length,
      conflicts: this.rows.filter((row) => row.status === 'conflict').length,
    }
  }

  async listRecent(limit: number): Promise<OutboxRow[]> {
    return this.rows.slice(0, limit)
  }

  async pruneAcked(): Promise<number> {
    const before = this.rows.length
    this.rows = this.rows.filter((row) => row.status !== 'acked')
    return before - this.rows.length
  }

  async readLastSuccessAt(): Promise<string | null> {
    return this.lastSuccessAt
  }

  async writeLastSuccessAt(iso: string): Promise<void> {
    this.lastSuccessAt = iso
  }

  status(id: string): OutboxStatus {
    const row = this.rows.find((candidate) => candidate.id === id)
    if (!row) throw new Error(`missing ${id}`)
    return row.status
  }
}

function okResults(request: PosUploadRequest): UploadItemResult[] {
  return request.transactions.map((transaction) => ({
    clientTransactionId: transaction.clientTransactionId,
    status: 'APPLIED',
    serverId: `server-${transaction.clientTransactionId}`,
    conflicts: [],
    resolved: {},
  }))
}

function responseFor(request: PosUploadRequest, results: UploadItemResult[]): PosUploadResponse {
  return { batchId: request.batchId, serverTime: '2026-10-23T10:00:00.000Z', results }
}

function scriptedClient(
  handler: (
    request: PosUploadRequest,
    call: number,
  ) => Promise<PosUploadResponse> | PosUploadResponse,
): { client: SyncClient; requests: PosUploadRequest[] } {
  const requests: PosUploadRequest[] = []
  return {
    requests,
    client: {
      async upload(request) {
        requests.push(request)
        return handler(request, requests.length)
      },
      async conflicts() {
        return []
      },
      async state() {
        return {
          pendingConflicts: 0,
          lastSaleAt: null,
          serverTime: '2026-10-23T10:00:00.000Z',
          configVersion: null,
        }
      },
    },
  }
}

function setup(options: {
  store?: MemoryStore
  client: SyncClient
  clock?: { value: number }
  online?: boolean
  batchSize?: number
}) {
  const store = options.store ?? new MemoryStore()
  const clock = options.clock ?? { value: Date.parse('2026-10-23T10:00:00.000Z') }
  const statuses: Array<Partial<UploadStatusSnapshot>> = []
  let snapshot: Partial<UploadStatusSnapshot> = {}
  const revoked: number[] = []
  const uploader = createUploader({
    store,
    client: options.client,
    device: () => ({ deviceId: 'device-1', terminalId: 'terminal-1' }),
    batchSize: () => options.batchSize ?? 25,
    online: () => options.online ?? true,
    now: () => new Date(clock.value),
    random: () => 0.5,
    onStatus: (patch) => {
      snapshot = { ...snapshot, ...patch }
      statuses.push(snapshot)
    },
    onRevoked: async () => {
      revoked.push(1)
    },
  })
  return { store, clock, statuses, revoked, uploader }
}

function latest(statuses: Array<Partial<UploadStatusSnapshot>>): Partial<UploadStatusSnapshot> {
  return statuses.at(-1) ?? {}
}

describe('uploader drain', () => {
  it('drains in FIFO order and honours the batch size', async () => {
    const { client, requests } = scriptedClient((request) =>
      responseFor(request, okResults(request)),
    )
    const { store, uploader } = setup({ client, batchSize: 2 })
    store.add({ id: 'sale-1', createdAt: '2026-10-23T09:00:00.000Z' })
    store.add({ id: 'sale-2', createdAt: '2026-10-23T09:01:00.000Z' })
    store.add({ id: 'sale-3', createdAt: '2026-10-23T09:02:00.000Z' })

    const result = await uploader.drain()

    expect(result).toEqual({ acked: 3, rejected: 0, stopReason: 'EMPTY' })
    expect(requests).toHaveLength(2)
    expect(requests[0]?.transactions.map((row) => row.clientTransactionId)).toEqual([
      'sale-1',
      'sale-2',
    ])
    expect(requests[1]?.transactions.map((row) => row.clientTransactionId)).toEqual(['sale-3'])
    expect(store.rows.every((row) => row.status === 'acked')).toBe(true)
  })

  it('sends the device and terminal from the live session', async () => {
    const { client, requests } = scriptedClient((request) =>
      responseFor(request, okResults(request)),
    )
    const { store, uploader } = setup({ client })
    store.add({ id: 'sale-1' })

    await uploader.drain()
    expect(requests[0]?.deviceId).toBe('device-1')
    expect(requests[0]?.terminalId).toBe('terminal-1')
    expect(requests[0]?.batchId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('treats REPLAYED as acknowledged', async () => {
    const { client } = scriptedClient((request) =>
      responseFor(
        request,
        okResults(request).map((result) => ({ ...result, status: 'REPLAYED' as const })),
      ),
    )
    const { store, uploader } = setup({ client })
    store.add({ id: 'sale-1' })

    const result = await uploader.drain()
    expect(result.acked).toBe(1)
    expect(store.status('sale-1')).toBe('acked')
  })

  it('continues after a REJECTED transaction instead of blocking later rows', async () => {
    const client = scriptedClient((request) =>
      responseFor(
        request,
        okResults(request).map((result, index) =>
          index === 0
            ? {
                ...result,
                status: 'REJECTED' as const,
                serverId: null,
                error: { code: 'UNKNOWN_PRODUCT', message: 'The product no longer exists' },
              }
            : result,
        ),
      ),
    ).client
    const { store, uploader } = setup({ client })
    store.add({ id: 'sale-bad', createdAt: '2026-10-23T09:00:00.000Z' })
    store.add({ id: 'sale-good', createdAt: '2026-10-23T09:01:00.000Z' })

    const result = await uploader.drain()

    expect(result.acked).toBe(1)
    expect(result.rejected).toBe(1)
    expect(store.status('sale-bad')).toBe('dead_letter')
    expect(store.status('sale-good')).toBe('acked')
  })

  it('dead-letters a corrupt row and still uploads the rest', async () => {
    const { client, requests } = scriptedClient((request) =>
      responseFor(request, okResults(request)),
    )
    const { store, uploader } = setup({ client })
    store.add({ id: 'corrupt', payload: null })
    store.add({ id: 'sale-1', createdAt: '2026-10-23T09:01:00.000Z' })

    await uploader.drain()

    expect(store.status('corrupt')).toBe('dead_letter')
    expect(store.status('sale-1')).toBe('acked')
    expect(requests).toHaveLength(1)
    expect(requests[0]?.transactions).toHaveLength(1)
  })

  it('stops without a request while offline, but a manual sync now tries', async () => {
    const { client, requests } = scriptedClient((request) =>
      responseFor(request, okResults(request)),
    )
    const { store, uploader, statuses } = setup({ client, online: false })
    store.add({ id: 'sale-1' })

    const scheduled = await uploader.drain()
    expect(scheduled.stopReason).toBe('OFFLINE')
    expect(requests).toHaveLength(0)
    expect(latest(statuses).pauseReason).toBe('OFFLINE')

    const manual = await uploader.syncNow()
    expect(manual.acked).toBe(1)
    expect(requests).toHaveLength(1)
  })

  it('pauses on 401 after the shared client already refreshed once', async () => {
    const error = Object.assign(new Error('Session expired'), { status: 401, code: 'UNAUTHORIZED' })
    let calls = 0
    const client = scriptedClient((request) => {
      calls += 1
      if (calls === 1) throw error
      return responseFor(request, okResults(request))
    }).client
    const { store, uploader, statuses } = setup({ client })
    store.add({ id: 'sale-1' })

    const paused = await uploader.drain()
    expect(paused.stopReason).toBe('AUTH')
    expect(store.status('sale-1')).toBe('pending')
    expect(store.rows[0]?.attempts).toBe(0)
    expect(latest(statuses).pauseReason).toBe('AUTH')

    const retried = await uploader.syncNow()
    expect(retried.acked).toBe(1)
  })

  it('pauses and revokes on 403', async () => {
    const error = Object.assign(new Error('revoked'), {
      status: 403,
      code: 'DEVICE_REVOKED',
    })
    const client = scriptedClient(() => {
      throw error
    }).client
    const { store, uploader, statuses, revoked } = setup({ client })
    store.add({ id: 'sale-1' })

    const result = await uploader.drain()

    expect(result.stopReason).toBe('REVOKED')
    expect(revoked).toHaveLength(1)
    expect(store.status('sale-1')).toBe('pending')
    expect(latest(statuses).pauseReason).toBe('REVOKED')
  })

  it('honours Retry-After on 429', async () => {
    const error = Object.assign(new Error('slow down'), {
      status: 429,
      code: 'RATE_LIMITED',
      retryAfterSeconds: 120,
    })
    const client = scriptedClient(() => {
      throw error
    }).client
    const clock = { value: Date.parse('2026-10-23T10:00:00.000Z') }
    const { store, uploader, statuses } = setup({ client, clock })
    store.add({ id: 'sale-1' })

    const result = await uploader.drain()

    expect(result.stopReason).toBe('THROTTLED')
    expect(store.rows[0]?.status).toBe('pending')
    expect(store.rows[0]?.nextAttemptAt).toBe(new Date(clock.value + 120_000).toISOString())
    expect(latest(statuses).pauseReason).toBe('THROTTLED')
  })

  it('backs off on 5xx, then succeeds without losing the sale', async () => {
    let calls = 0
    const client = scriptedClient((request) => {
      calls += 1
      if (calls <= 2) {
        throw Object.assign(new Error('boom'), { status: 503, code: 'SERVICE_UNAVAILABLE' })
      }
      return responseFor(request, okResults(request))
    }).client
    const clock = { value: Date.parse('2026-10-23T10:00:00.000Z') }
    const { store, uploader, statuses } = setup({ client, clock })
    store.add({ id: 'sale-1' })

    expect((await uploader.drain()).stopReason).toBe('SERVER')
    expect(store.rows[0]?.attempts).toBe(1)
    expect(store.rows[0]?.nextAttemptAt).toBe(
      new Date(clock.value + 1_000).toISOString(), // no jitter with random=0.5
    )
    expect(latest(statuses).pauseReason).toBe('SERVER')

    // Not due yet: no request.
    expect((await uploader.drain()).stopReason).toBe('EMPTY')
    expect(calls).toBe(1)

    clock.value += 1_000
    expect((await uploader.drain()).stopReason).toBe('SERVER')
    expect(store.rows[0]?.attempts).toBe(2)

    clock.value += 2_000
    const recovered = await uploader.drain()
    expect(recovered.acked).toBe(1)
    expect(store.status('sale-1')).toBe('acked')
    expect(store.lastSuccessAt).toBe(new Date(clock.value).toISOString())
  })

  it('treats a network failure as transient', async () => {
    const client = scriptedClient(() => {
      throw Object.assign(new Error('Cannot reach the server'), {
        status: 0,
        code: 'NETWORK_ERROR',
      })
    }).client
    const { store, uploader, statuses } = setup({ client })
    store.add({ id: 'sale-1' })

    await uploader.drain()
    expect(store.rows[0]?.status).toBe('pending')
    expect(store.rows[0]?.attempts).toBe(1)
    expect(store.rows[0]?.lastErrorCode).toBe('NETWORK_ERROR')
    expect(latest(statuses).pauseReason).toBe('SERVER')
  })

  it('does not run two drains at once', async () => {
    let resolveUpload: (value: PosUploadResponse) => void = () => {}
    const requests: PosUploadRequest[] = []
    const client: SyncClient = {
      upload(request) {
        requests.push(request)
        return new Promise<PosUploadResponse>((resolve) => {
          resolveUpload = resolve
        })
      },
      conflicts: async () => [],
      state: async () => ({
        pendingConflicts: 0,
        lastSaleAt: null,
        serverTime: '',
        configVersion: null,
      }),
    }
    const { store, uploader } = setup({ client })
    store.add({ id: 'sale-1' })

    const first = uploader.drain()
    const second = uploader.drain()
    expect(second).toBe(first)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const request = requests[0]
    if (!request) throw new Error('expected one upload request')
    resolveUpload(responseFor(request, okResults(request)))
    expect((await first).acked).toBe(1)
  })

  it('shares one drain across uploader instances (route hand-off)', async () => {
    let resolveUpload: (value: PosUploadResponse) => void = () => {}
    const requests: PosUploadRequest[] = []
    const client: SyncClient = {
      upload(request) {
        requests.push(request)
        return new Promise<PosUploadResponse>((resolve) => {
          resolveUpload = resolve
        })
      },
      conflicts: async () => [],
      state: async () => ({
        pendingConflicts: 0,
        lastSaleAt: null,
        serverTime: '',
        configVersion: null,
      }),
    }
    const store = new MemoryStore()
    store.add({ id: 'sale-1' })
    const make = () =>
      createUploader({
        store,
        client,
        device: () => ({ deviceId: 'device-1', terminalId: 'terminal-1' }),
        batchSize: () => 25,
        online: () => true,
        now: () => new Date('2026-10-23T10:00:00.000Z'),
        onStatus: () => {},
        onRevoked: async () => {},
      })
    const first = make()
    const second = make()

    const a = first.drain()
    const b = second.drain()
    expect(a).toBe(b)
    await vi.waitFor(() => expect(requests).toHaveLength(1))
    const request = requests[0]
    if (!request) throw new Error('expected one upload request')
    resolveUpload(responseFor(request, okResults(request)))
    expect((await a).acked).toBe(1)
    expect((await b).acked).toBe(1)
  })

  it('recovers an incomplete response on the next drain (server replay)', async () => {
    let calls = 0
    const client = scriptedClient((request) => {
      calls += 1
      if (calls === 1) return responseFor(request, [])
      return responseFor(request, okResults(request))
    }).client
    const { store, uploader, statuses } = setup({ client })
    store.add({ id: 'sale-1' })

    const ambiguous = await uploader.drain()
    expect(ambiguous.stopReason).toBe('AMBIGUOUS')
    expect(store.status('sale-1')).toBe('in_flight')
    expect(latest(statuses).lastError).toMatch(/incomplete/)

    const recovered = await uploader.drain()
    expect(recovered.acked).toBe(1)
    expect(store.status('sale-1')).toBe('acked')
  })

  it('dead-letters a 400 batch with a readable code', async () => {
    const client = scriptedClient(() => {
      throw Object.assign(new Error('Invalid batch'), {
        status: 400,
        code: 'INVALID_BATCH',
      })
    }).client
    const { store, uploader } = setup({ client })
    store.add({ id: 'sale-1' })

    const result = await uploader.drain()
    expect(result.stopReason).toBe('BAD_REQUEST')
    expect(store.status('sale-1')).toBe('dead_letter')
    expect(store.rows[0]?.lastErrorCode).toBe('INVALID_BATCH')
  })

  it('publishes pending and last-success status without payload data', async () => {
    const { client } = scriptedClient((request) => responseFor(request, okResults(request)))
    const { store, uploader, statuses } = setup({ client })
    store.add({ id: 'sale-1' })

    await uploader.drain()

    expect(statuses.some((patch) => patch.draining === true)).toBe(true)
    expect(statuses.some((patch) => patch.pending === 1)).toBe(true)
    expect(statuses.at(-1)?.pending).toBe(0)
    expect(statuses.at(-1)?.lastSuccessAt).toBeTruthy()
    expect(JSON.stringify(statuses)).not.toContain('receiptNumber')
  })
})
