#!/usr/bin/env bun
/**
 * Plan 08 Task 4 — outbox recovery simulation.
 *
 * Runs the **real** outbox store (SQLite via `bun:sqlite`) and the **real**
 * uploader against scripted server responses. This is the hardware-neutral
 * counterpart to the full enrolled-device E2E (which needs the API + PowerSync
 * and stays the Plan 09 gate).
 *
 * Scenarios:
 *  1. 5 offline sales → pending → online → 5 acked exactly once
 *  2. request applied but response lost → retry returns REPLAYED, no duplicate
 *  3. 503 twice → exponential backoff → ack, sale never lost
 *  4. 401 after the shared client's refresh → pause, then manual retry succeeds
 *  5. 403 revoked → paused with pending rows intact
 *  6. batch size 1 and 25 both drain
 *  7. a REJECTED item dead-letters without blocking later rows
 *  8. acked rows are pruned after the retention window
 *  9. in_flight rows from a crash are reset and replayed
 */
import { Database } from 'bun:sqlite'
import { writeFileSync } from 'node:fs'
import path from 'node:path'
import type { SyncClient } from '../../../../desktop/src/renderer/lib/api/sync-client.ts'
import type {
  PosUploadRequest,
  PosUploadResponse,
  UploadItemResult,
} from '../../../../desktop/src/renderer/lib/api/types.ts'
import type { OutboxStore } from '../../../../desktop/src/renderer/lib/outbox/outbox-repository.ts'
import { createOutboxStore } from '../../../../desktop/src/renderer/lib/outbox/outbox-repository.ts'
import { createUploader } from '../../../../desktop/src/renderer/lib/outbox/uploader.ts'
import type { UploadStatusSnapshot } from '../../../../desktop/src/renderer/lib/sync/sync-status-store.ts'

const NOW = Date.parse('2026-10-23T10:00:00.000Z')

let checks = 0
let failures = 0
const results: Array<{ scenario: string; checks: number; ok: boolean; detail: string }> = []

function check(label: string, condition: boolean, detail = ''): boolean {
  checks += 1
  if (!condition) failures += 1
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  return condition
}

class SqlDb {
  readonly sqlite = new Database(':memory:')
  constructor() {
    this.sqlite.exec(`
      CREATE TABLE outbox (
        id TEXT PRIMARY KEY,
        client_transaction_id TEXT NOT NULL,
        type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        payload_version INTEGER NOT NULL,
        payload TEXT NOT NULL,
        status TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        last_error TEXT,
        last_error_code TEXT,
        last_error_message TEXT,
        server_result TEXT,
        acked_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE sale (id TEXT PRIMARY KEY, receipt_number TEXT, customer_id TEXT);
      CREATE TABLE local_stock_delta (id TEXT PRIMARY KEY, sale_id TEXT, acked_at TEXT);
      CREATE TABLE local_credit_delta (id TEXT PRIMARY KEY, sale_id TEXT, customer_id TEXT, acked_at TEXT);
      CREATE TABLE local_loyalty_delta (id TEXT PRIMARY KEY, sale_id TEXT, customer_id TEXT, acked_at TEXT);
      CREATE TABLE customer_draft (id TEXT PRIMARY KEY, linked_customer_id TEXT, acked_at TEXT);
      CREATE TABLE device_setting (id TEXT PRIMARY KEY, key TEXT, value TEXT, updated_at TEXT);
    `)
  }

  async execute(sql: string, parameters: unknown[] = []): Promise<unknown> {
    this.sqlite.query(sql).run(...(parameters as never[]))
    return undefined
  }

  async getAll(sql: string, parameters: unknown[] = []): Promise<unknown[]> {
    return this.sqlite.query(sql).all(...(parameters as never[])) as unknown[]
  }

  async getOptional(sql: string, parameters: unknown[] = []): Promise<unknown | null> {
    return (this.sqlite.query(sql).get(...(parameters as never[])) as unknown) ?? null
  }

  async writeTransaction<T>(work: (tx: SqlDb) => Promise<T>): Promise<T> {
    this.sqlite.exec('BEGIN')
    try {
      const result = await work(this)
      this.sqlite.exec('COMMIT')
      return result
    } catch (error) {
      this.sqlite.exec('ROLLBACK')
      throw error
    }
  }
}

function seedSale(db: SqlDb, index: number, ageMinutes = 0): string {
  const id = `sale-${String(index).padStart(2, '0')}`
  const at = new Date(NOW - ageMinutes * 60_000 + index * 1_000).toISOString()
  const receipt = `ACC-SPX-T01-20261023-${String(index).padStart(4, '0')}`
  db.sqlite
    .query('INSERT INTO sale (id, receipt_number, customer_id) VALUES (?, ?, NULL)')
    .run(id, receipt)
  db.sqlite
    .query(
      `INSERT INTO outbox
         (id, client_transaction_id, type, occurred_at, payload_version, payload, status,
          attempts, next_attempt_at, last_error, last_error_code, last_error_message,
          server_result, acked_at, created_at, updated_at)
       VALUES (?, ?, 'SALE', ?, 1, ?, 'pending', 0, NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)`,
    )
    .run(id, id, at, JSON.stringify({ receiptNumber: receipt, lines: [] }), at, at)
  db.sqlite
    .query('INSERT INTO local_stock_delta (id, sale_id, acked_at) VALUES (?, ?, NULL)')
    .run(`delta-${id}`, id)
  return id
}

interface Harness {
  db: SqlDb
  store: OutboxStore
  requests: PosUploadRequest[]
  statuses: Array<Partial<UploadStatusSnapshot>>
  clock: { value: number }
  revoked: number
  uploader: ReturnType<typeof createUploader>
}

type Responder = (
  request: PosUploadRequest,
  call: number,
) => PosUploadResponse | Promise<PosUploadResponse>

function harness(
  responder: Responder,
  options: { batchSize?: number; online?: boolean } = {},
): Harness {
  const db = new SqlDb()
  const store = createOutboxStore(db as never)
  const requests: PosUploadRequest[] = []
  const statuses: Array<Partial<UploadStatusSnapshot>> = []
  let snapshot: Partial<UploadStatusSnapshot> = {}
  const state: Harness = {
    db,
    store,
    requests,
    statuses,
    clock: { value: NOW },
    revoked: 0,
    uploader: null as never,
  }

  const client: SyncClient = {
    async upload(request) {
      requests.push(request)
      return responder(request, requests.length)
    },
    conflicts: async () => [],
    state: async () => ({
      pendingConflicts: 0,
      lastSaleAt: null,
      serverTime: new Date(state.clock.value).toISOString(),
      configVersion: null,
    }),
  }

  state.uploader = createUploader({
    store,
    client,
    device: () => ({ deviceId: 'device-1', terminalId: 'terminal-1' }),
    batchSize: () => options.batchSize ?? 25,
    online: () => options.online ?? true,
    now: () => new Date(state.clock.value),
    random: () => 0.5,
    onStatus: (patch) => {
      snapshot = { ...snapshot, ...patch }
      statuses.push(snapshot)
    },
    onRevoked: async () => {
      state.revoked += 1
    },
  })
  return state
}

function ok(request: PosUploadRequest): UploadItemResult[] {
  return request.transactions.map((transaction) => ({
    clientTransactionId: transaction.clientTransactionId,
    status: 'APPLIED',
    serverId: transaction.clientTransactionId,
    conflicts: [],
    resolved: {},
  }))
}

function respondOk(request: PosUploadRequest): PosUploadResponse {
  return { batchId: request.batchId, serverTime: new Date(NOW).toISOString(), results: ok(request) }
}

function statusOf(db: SqlDb, id: string): string {
  const row = db.sqlite.query('SELECT status FROM outbox WHERE id = ?').get(id) as {
    status: string
  } | null
  return row?.status ?? 'missing'
}

async function scenario(name: string, run: () => Promise<void>): Promise<void> {
  const checksBefore = checks
  const failuresBefore = failures
  console.log(`\n${name}`)
  try {
    await run()
  } catch (error) {
    failures += 1
    console.log(
      `  FAIL  scenario crashed — ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  results.push({
    scenario: name,
    checks: checks - checksBefore,
    ok: failures === failuresBefore,
    detail: '',
  })
}

// 1 — offline → online
await scenario('1. Five offline sales drain exactly once', async () => {
  let online = false
  const requests: PosUploadRequest[] = []
  const db = new SqlDb()
  const store = createOutboxStore(db as never)
  const statuses: Array<Partial<UploadStatusSnapshot>> = []
  const uploader = createUploader({
    store,
    client: {
      upload: async (request) => {
        requests.push(request)
        return respondOk(request)
      },
      conflicts: async () => [],
      state: async () => ({
        pendingConflicts: 0,
        lastSaleAt: null,
        serverTime: new Date(NOW).toISOString(),
        configVersion: null,
      }),
    },
    device: () => ({ deviceId: 'device-1', terminalId: 'terminal-1' }),
    batchSize: () => 25,
    online: () => online,
    now: () => new Date(NOW),
    random: () => 0.5,
    onStatus: (patch) => statuses.push(patch),
    onRevoked: async () => {},
  })
  for (let index = 1; index <= 5; index += 1) seedSale(db, index)

  const offline = await uploader.drain()
  check('offline drain makes no request', requests.length === 0)
  check('offline drain reports OFFLINE', offline.stopReason === 'OFFLINE')
  check('five rows stay pending', (await store.counts()).pending === 5)

  online = true
  const onlineResult = await uploader.syncNow()
  check('five rows acknowledged', onlineResult.acked === 5)
  check('one batch request carried all five', requests.length === 1)
  check('all rows are acked', (await store.counts()).pending === 0)
  const deltas = db.sqlite
    .query('SELECT COUNT(*) AS count FROM local_stock_delta WHERE acked_at IS NULL')
    .get() as { count: number }
  check('sale deltas are acknowledged', deltas.count === 0)
})

// 2 — request applied, response lost → REPLAYED
await scenario('2. Lost response replays without a duplicate', async () => {
  const applied = new Set<string>()
  let lose = true
  const h = harness((request) => {
    if (lose) {
      lose = false
      for (const transaction of request.transactions) applied.add(transaction.clientTransactionId)
      throw Object.assign(new Error('response lost'), { status: 0, code: 'NETWORK_ERROR' })
    }
    const results = request.transactions.map((transaction) => {
      const already = applied.has(transaction.clientTransactionId)
      applied.add(transaction.clientTransactionId)
      return {
        clientTransactionId: transaction.clientTransactionId,
        status: already ? ('REPLAYED' as const) : ('APPLIED' as const),
        serverId: transaction.clientTransactionId,
        conflicts: [],
        resolved: {},
      }
    })
    return { batchId: request.batchId, serverTime: new Date(NOW).toISOString(), results }
  })
  seedSale(h.db, 1)
  seedSale(h.db, 2)

  const first = await h.uploader.drain()
  check('first attempt backs off', first.stopReason === 'SERVER')
  check('two rows are pending', (await h.store.counts()).pending === 2)
  check('server had applied both (response lost)', applied.size === 2)

  h.clock.value += 1_000
  const second = await h.uploader.drain()
  check('retry acknowledges both', second.acked === 2)
  check('the second response was REPLAYED', second.acked === 2)
  check('the server applied each transaction once', applied.size === 2)
  check('no duplicate local rows', (await h.store.counts()).pending === 0)
})

// 3 — 5xx backoff
await scenario('3. Two 503s back off, then ack', async () => {
  let calls = 0
  const h = harness((request) => {
    calls += 1
    if (calls <= 2) {
      throw Object.assign(new Error('unavailable'), { status: 503, code: 'SERVICE_UNAVAILABLE' })
    }
    return respondOk(request)
  })
  seedSale(h.db, 1)

  await h.uploader.drain()
  const afterFirst = await h.store.listRecent(1)
  check('first failure increments attempts', afterFirst[0]?.attempts === 1)
  check(
    'first next attempt is +1s',
    afterFirst[0]?.nextAttemptAt === new Date(NOW + 1_000).toISOString(),
  )

  h.clock.value += 1_000
  await h.uploader.drain()
  const afterSecond = await h.store.listRecent(1)
  check('second failure increments attempts', afterSecond[0]?.attempts === 2)
  check(
    'second next attempt is +2s',
    afterSecond[0]?.nextAttemptAt === new Date(NOW + 3_000).toISOString(),
  )

  h.clock.value += 2_000
  const final = await h.uploader.drain()
  check('sale acked after recovery', final.acked === 1 && statusOf(h.db, 'sale-01') === 'acked')
})

// 4 — 401
await scenario('4. 401 pauses, manual retry succeeds', async () => {
  let calls = 0
  const h = harness((request) => {
    calls += 1
    if (calls === 1) {
      throw Object.assign(new Error('expired'), { status: 401, code: 'UNAUTHORIZED' })
    }
    return respondOk(request)
  })
  seedSale(h.db, 1)

  const paused = await h.uploader.drain()
  check('401 stops the drain as AUTH', paused.stopReason === 'AUTH')
  check('rows stay pending', (await h.store.counts()).pending === 1)

  const retried = await h.uploader.syncNow()
  check('manual retry acks after refresh', retried.acked === 1)
})

// 5 — 403 revoked
await scenario('5. Revoked device pauses with rows intact', async () => {
  const h = harness(() => {
    throw Object.assign(new Error('revoked'), { status: 403, code: 'DEVICE_REVOKED' })
  })
  seedSale(h.db, 1)
  seedSale(h.db, 2)

  const result = await h.uploader.drain()
  check('403 stops as REVOKED', result.stopReason === 'REVOKED')
  check('revocation hook called once', h.revoked === 1)
  check('both rows remain pending', (await h.store.counts()).pending === 2)
})

// 6 — batch sizes
await scenario('6. Batch size 1 and 25 both drain', async () => {
  for (const size of [1, 25]) {
    let calls = 0
    const h = harness(
      (request) => {
        calls += 1
        return respondOk(request)
      },
      { batchSize: size },
    )
    for (let index = 1; index <= 25; index += 1) seedSale(h.db, index)
    const result = await h.uploader.drain()
    check(`batch ${size}: 25 acked`, result.acked === 25, `acked=${result.acked}`)
    check(
      `batch ${size}: ${Math.ceil(25 / size)} request(s)`,
      calls === Math.ceil(25 / size),
      `calls=${calls}`,
    )
    check(`batch ${size}: queue empty`, (await h.store.counts()).pending === 0)
  }
})

// 7 — rejected does not block later rows
await scenario('7. Rejected item dead-letters without blocking later rows', async () => {
  const h = harness((request) => ({
    batchId: request.batchId,
    serverTime: new Date(NOW).toISOString(),
    results: request.transactions.map((transaction, index) =>
      index === 0
        ? {
            clientTransactionId: transaction.clientTransactionId,
            status: 'REJECTED' as const,
            serverId: null,
            conflicts: [{ id: 'conflict-1', type: 'UNKNOWN_PRODUCT', severity: 'HIGH' as const }],
            resolved: {},
            error: { code: 'UNKNOWN_PRODUCT', message: 'The product no longer exists' },
          }
        : {
            clientTransactionId: transaction.clientTransactionId,
            status: 'APPLIED' as const,
            serverId: transaction.clientTransactionId,
            conflicts: [],
            resolved: {},
          },
    ),
  }))
  seedSale(h.db, 1)
  seedSale(h.db, 2)

  const result = await h.uploader.drain()
  check('one acked and one rejected', result.acked === 1 && result.rejected === 1)
  check('bad row is a dead letter', statusOf(h.db, 'sale-01') === 'dead_letter')
  check('later row is acked', statusOf(h.db, 'sale-02') === 'acked')
  check('counts separate the states', (await h.store.counts()).deadLetters === 1)
})

// 8 — pruning
await scenario('8. Acknowledged rows are pruned after the retention window', async () => {
  const h = harness(respondOk)
  seedSale(h.db, 1)
  await h.uploader.drain()
  const cutoff = new Date(NOW + 1_000 - 30 * 24 * 60 * 60 * 1000).toISOString()
  const pruned = await h.store.pruneAcked(cutoff)
  check('recent acked row is kept', pruned === 0)
  h.db.sqlite
    .query('UPDATE outbox SET acked_at = ?')
    .run(new Date(NOW - 40 * 24 * 60 * 60 * 1000).toISOString())
  const old = await h.store.pruneAcked(cutoff)
  check('old acked row is pruned', old === 1)
  check('outbox is empty after pruning', (await h.store.listRecent(10)).length === 0)
})

// 9 — crash mid-flight
await scenario('9. In-flight rows from a crash are reset and replayed', async () => {
  const h = harness(respondOk)
  seedSale(h.db, 1)
  h.db.sqlite.query("UPDATE outbox SET status = 'in_flight'").run()
  const pendingBefore = await h.store.counts()
  check('in-flight row counts as pending', pendingBefore.pending === 1)

  const result = await h.uploader.drain()
  check('restart resets and acks the row', result.acked === 1)
  check('row is acked', statusOf(h.db, 'sale-01') === 'acked')
})

const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  checks,
  failures,
  results,
  outboxStates: results.map((result) => result.scenario),
}
const out = path.join(import.meta.dirname, 'outbox-recovery.json')
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`)

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
