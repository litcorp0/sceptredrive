import {
  column,
  createConsoleLogger,
  LogLevels,
  PowerSyncDatabase,
  Schema,
  Table,
  WASQLiteOpenFactory,
  WASQLiteVFS,
} from '@powersync/web'
import { POS_WORKER_URL } from './database'
import { PosSchema } from './schema'

/**
 * P10-D15 — prove the `sale_terminal_occurred` index migrates a database that
 * already holds sales.
 *
 * The failure mode this exists for is a till holding a day of unuploaded sales:
 * the local database lives in Electron's `userData`, is encrypted at rest, and
 * cannot be rebuilt on a live terminal without losing that day. So the proof is
 * two real opens of one real SQLite file through the same `WASQLiteOpenFactory`
 * the renderer uses, with the same worker, VFS, and encryption key:
 *
 *   1. create the file with the **previous** schema (frozen below), write a
 *      day's trading — an open shift, two sales with their lines and tenders, a
 *      cash movement, and three pending outbox rows — then close it;
 *   2. reopen the same file with `PosSchema` and read every row back, then assert
 *      that the home screen's day window plans through the new index.
 *
 * Nothing here is mocked: the engine, worker, VFS, and cipher are the till's.
 * The in-page seam is the `#dev/sync` diagnostics page, driven by
 * `desktop/test/e2e/schema-migration.mjs`. The fast check that the index is still
 * declared in the schema is `schema-indexes.test.ts`.
 */

/**
 * FROZEN — `sale` exactly as it shipped before Phase 10.
 *
 * The literal copy is the point: if this tracked `schema.ts`, an edit that
 * removed `sale_terminal_occurred` again would "migrate" a database that never
 * had the index and the proof would pass while proving nothing. Do not update
 * this to match new work — a deliberate change to `sale` is supposed to make the
 * case fail loudly so the migration is re-proven.
 */
const previousSale = new Table(
  {
    receipt_number: column.text,
    branch_id: column.text,
    terminal_id: column.text,
    device_id: column.text,
    shift_id: column.text,
    client_transaction_id: column.text,
    cashier_user_id: column.text,
    cashier_staff_id: column.text,
    customer_id: column.text,
    occurred_at: column.text,
    subtotal_minor: column.integer,
    line_discount_minor: column.integer,
    sale_discount_minor: column.integer,
    loyalty_redeem_points: column.integer,
    loyalty_discount_minor: column.integer,
    vat_minor: column.integer,
    nhil_minor: column.integer,
    getfund_minor: column.integer,
    tax_total_minor: column.integer,
    total_minor: column.integer,
    tender_total_minor: column.integer,
    change_minor: column.integer,
    loyalty_earned_points: column.integer,
    credit_amount_minor: column.integer,
    tax_mode: column.text,
    app_version: column.text,
    print_status: column.text,
    printed_at: column.text,
    print_error: column.text,
    reprint_count: column.integer,
    created_at: column.text,
  },
  {
    localOnly: true,
    /** FROZEN — the two indexes the terminal shipped with. */
    indexes: {
      sale_shift: ['shift_id'],
      sale_occurred: ['occurred_at'],
    },
  },
).copyWithName('sale')

/**
 * The previous local schema: every current table, with the frozen `sale`.
 *
 * Built from `PosSchema.tables` (already-resolved tables) rather than the module's
 * table objects, so a new table added to `schema.ts` is part of both schemas and
 * the only difference under proof stays the one index.
 */
export const PreviousPosSchema = new Schema(
  PosSchema.tables.map((table) => (table.name === 'sale' ? previousSale : table)),
)

export type SchemaMigrationStep = { name: string; ok: boolean; detail?: string }

export interface SchemaMigrationReport {
  ok: boolean
  vfs: string
  /** The throw-away database file the proof used. */
  database: string
  steps: SchemaMigrationStep[]
  /** Rows per table after the migration — the "every row still reads" evidence. */
  counts: Record<string, number>
  /** Index names (as declared in the schema) that exist after the migration. */
  indexes: string[]
  /** `EXPLAIN QUERY PLAN` detail lines for the home screen's day-window query. */
  queryPlan: string[]
  durationMs: number
}

export interface SchemaMigrationOptions {
  /** Keychain key. The proof opens an encrypted database, like the till does. */
  encryptionKey: string
  vfs?: WASQLiteVFS
  terminalId?: string
}

/**
 * A fresh file per run: the proof must start from the previous schema, and a file
 * left behind by an earlier run is already migrated. The adapter has no delete
 * API, so the file stays in the profile — a few hundred kilobytes, and the e2e
 * deletes the whole throw-away profile.
 */
export const MIGRATION_DB_PREFIX = 'sceptre-drive-schema-migration'

/** A representative day: one Accra day, one terminal, one shift. */
const FIXTURE = {
  branchId: 'branch-migration',
  terminalId: 'terminal-migration-01',
  deviceId: 'device-migration-01',
  shiftId: 'shift-migration-01',
  cashierUserId: 'user-migration-01',
  cashierStaffId: 'staff-migration-01',
  from: '2026-10-25T00:00:00.000Z',
  to: '2026-10-26T00:00:00.000Z',
  sales: [
    {
      id: 'sale-migration-01',
      receiptNumber: 'MIG-0001',
      occurredAt: '2026-10-25T09:12:04.000Z',
      subtotalMinor: 9_600,
      vatMinor: 1_440,
      nhilMinor: 240,
      getfundMinor: 240,
      taxTotalMinor: 1_920,
      totalMinor: 11_520,
      tenderMinor: 20_000,
      changeMinor: 8_480,
      productId: 'product-migration-01',
      sku: 'MIG-SKU-1',
      name: 'Migration item one',
      quantity: 2,
      unitPriceMinor: 4_800,
    },
    {
      id: 'sale-migration-02',
      receiptNumber: 'MIG-0002',
      occurredAt: '2026-10-25T15:47:39.000Z',
      subtotalMinor: 4_800,
      vatMinor: 720,
      nhilMinor: 120,
      getfundMinor: 120,
      taxTotalMinor: 960,
      totalMinor: 5_760,
      tenderMinor: 5_760,
      changeMinor: 0,
      productId: 'product-migration-02',
      sku: 'MIG-SKU-2',
      name: 'Migration item two',
      quantity: 1,
      unitPriceMinor: 4_800,
    },
  ],
} as const

const SALE_COLUMNS = [
  'receipt_number',
  'branch_id',
  'terminal_id',
  'device_id',
  'shift_id',
  'client_transaction_id',
  'cashier_user_id',
  'cashier_staff_id',
  'customer_id',
  'occurred_at',
  'subtotal_minor',
  'line_discount_minor',
  'sale_discount_minor',
  'loyalty_redeem_points',
  'loyalty_discount_minor',
  'vat_minor',
  'nhil_minor',
  'getfund_minor',
  'tax_total_minor',
  'total_minor',
  'tender_total_minor',
  'change_minor',
  'loyalty_earned_points',
  'credit_amount_minor',
  'tax_mode',
  'app_version',
  'print_status',
  'printed_at',
  'print_error',
  'reprint_count',
  'created_at',
] as const

const SALE_LINE_COLUMNS = [
  'sale_id',
  'product_id',
  'line_number',
  'sku',
  'name',
  'barcode',
  'quantity',
  'unit_price_minor',
  'expected_unit_price_minor',
  'line_discount_minor',
  'sale_discount_minor',
  'loyalty_discount_minor',
  'net_minor',
  'taxable_minor',
  'base_minor',
  'vat_minor',
  'nhil_minor',
  'getfund_minor',
  'tax_total_minor',
  'total_minor',
  'tax_category',
] as const

const SALE_TENDER_COLUMNS = ['sale_id', 'method', 'amount_minor', 'reference', 'created_at']

const CASH_MOVEMENT_COLUMNS = [
  'shift_id',
  'branch_id',
  'terminal_id',
  'device_id',
  'type',
  'amount_minor',
  'reason',
  'occurred_at',
  'staff_user_id',
  'staff_staff_id',
] as const

const SHIFT_COLUMNS = [
  'number',
  'branch_id',
  'terminal_id',
  'device_id',
  'cashier_user_id',
  'cashier_staff_id',
  'status',
  'opened_at',
  'closed_at',
  'opening_float_minor',
  'counted_cash_minor',
  'client_expected_cash_minor',
  'close_note',
  'opened_by',
  'closed_by',
  'created_at',
] as const

const OUTBOX_COLUMNS = [
  'client_transaction_id',
  'type',
  'occurred_at',
  'payload_version',
  'payload',
  'status',
  'attempts',
  'next_attempt_at',
  'last_error',
  'server_result',
  'created_at',
  'updated_at',
] as const

/** `id` is implicit on every PowerSync table; it leads every insert. */
function insertSql(table: string, columns: readonly string[]): string {
  const placeholders = ['id', ...columns].map(() => '?').join(', ')
  return `INSERT INTO ${table} (id, ${columns.join(', ')}) VALUES (${placeholders})`
}

/** The payloads are what a queued sale's truth looks like during an outage. */
const OUTBOX_ROWS = [
  {
    id: 'outbox-migration-01',
    clientTransactionId: 'ctx-migration-01',
    type: 'SHIFT_OPEN',
    occurredAt: '2026-10-25T08:55:00.000Z',
    payload: { shiftId: FIXTURE.shiftId, openingFloatMinor: 20_000 },
  },
  {
    id: 'outbox-migration-02',
    clientTransactionId: 'ctx-migration-02',
    type: 'SALE',
    occurredAt: '2026-10-25T09:12:04.000Z',
    payload: { saleId: FIXTURE.sales[0].id, receiptNumber: FIXTURE.sales[0].receiptNumber },
  },
  {
    id: 'outbox-migration-03',
    clientTransactionId: 'ctx-migration-03',
    type: 'CASH_MOVEMENT',
    occurredAt: '2026-10-25T12:30:00.000Z',
    payload: { shiftId: FIXTURE.shiftId, type: 'CASH_IN', amountMinor: 5_000 },
  },
] as const

const PLAN_SQL =
  'EXPLAIN QUERY PLAN SELECT * FROM sale WHERE terminal_id = ? AND occurred_at >= ? AND occurred_at < ?'

const STEP_TIMEOUT_MS = 30_000

async function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${STEP_TIMEOUT_MS}ms`)),
          STEP_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function createDatabase(
  filename: string,
  schema: Schema,
  encryptionKey: string,
  vfs: WASQLiteVFS,
): PowerSyncDatabase {
  // The production open options, verbatim (see `database.ts`): if the migration
  // works anywhere else, it does not prove anything about this till.
  const factory = new WASQLiteOpenFactory({
    open: {
      dbFilename: filename,
      vfs,
      encryptionKey,
      enableMultiTabs: false,
      worker: POS_WORKER_URL,
      preparedStatementsCache: 64,
    },
    logger: createConsoleLogger({ minLevel: LogLevels.warn }),
  })

  return new PowerSyncDatabase({ schema, factory })
}

async function writeFixtures(db: PowerSyncDatabase): Promise<void> {
  const openedAt = '2026-10-25T08:55:00.000Z'

  // One transaction, like `completeSale`: a sale without its outbox row would be
  // a lost sale, so the fixtures have the same shape.
  await db.writeTransaction(async (tx) => {
    await tx.execute(insertSql('shift', SHIFT_COLUMNS), [
      FIXTURE.shiftId,
      'SHIFT-MIG-01',
      FIXTURE.branchId,
      FIXTURE.terminalId,
      FIXTURE.deviceId,
      FIXTURE.cashierUserId,
      FIXTURE.cashierStaffId,
      'open',
      openedAt,
      null,
      20_000,
      null,
      null,
      null,
      FIXTURE.cashierUserId,
      null,
      openedAt,
    ])

    for (const sale of FIXTURE.sales) {
      await tx.execute(insertSql('sale', SALE_COLUMNS), [
        sale.id,
        sale.receiptNumber,
        FIXTURE.branchId,
        FIXTURE.terminalId,
        FIXTURE.deviceId,
        FIXTURE.shiftId,
        `ctx-${sale.id}`,
        FIXTURE.cashierUserId,
        FIXTURE.cashierStaffId,
        null,
        sale.occurredAt,
        sale.subtotalMinor,
        0,
        0,
        0,
        0,
        sale.vatMinor,
        sale.nhilMinor,
        sale.getfundMinor,
        sale.taxTotalMinor,
        sale.totalMinor,
        sale.tenderMinor,
        sale.changeMinor,
        0,
        0,
        'inclusive',
        '0.1.0-migration',
        'pending',
        null,
        null,
        0,
        sale.occurredAt,
      ])

      await tx.execute(insertSql('sale_line', SALE_LINE_COLUMNS), [
        `${sale.id}-line-1`,
        sale.id,
        sale.productId,
        1,
        sale.sku,
        sale.name,
        null,
        sale.quantity,
        sale.unitPriceMinor,
        sale.unitPriceMinor,
        0,
        0,
        0,
        sale.subtotalMinor,
        sale.subtotalMinor,
        sale.subtotalMinor,
        sale.vatMinor,
        sale.nhilMinor,
        sale.getfundMinor,
        sale.taxTotalMinor,
        sale.totalMinor,
        'standard',
      ])

      await tx.execute(insertSql('sale_tender', SALE_TENDER_COLUMNS), [
        `${sale.id}-tender-1`,
        sale.id,
        'CASH',
        sale.tenderMinor,
        null,
        sale.occurredAt,
      ])
    }

    await tx.execute(insertSql('cash_movement', CASH_MOVEMENT_COLUMNS), [
      'cash-migration-01',
      FIXTURE.shiftId,
      FIXTURE.branchId,
      FIXTURE.terminalId,
      FIXTURE.deviceId,
      'CASH_IN',
      5_000,
      'Float top-up before the afternoon rush',
      '2026-10-25T12:30:00.000Z',
      FIXTURE.cashierUserId,
      FIXTURE.cashierStaffId,
    ])

    for (const row of OUTBOX_ROWS) {
      await tx.execute(insertSql('outbox', OUTBOX_COLUMNS), [
        row.id,
        row.clientTransactionId,
        row.type,
        row.occurredAt,
        1,
        JSON.stringify(row.payload),
        'pending',
        0,
        null,
        null,
        null,
        row.occurredAt,
        row.occurredAt,
      ])
    }
  })
}

/** Tables the fixtures wrote, and how many rows each must have afterwards. */
const EXPECTED_COUNTS: Record<string, number> = {
  shift: 1,
  sale: 2,
  sale_line: 2,
  sale_tender: 2,
  cash_movement: 1,
  outbox: 3,
}

async function readCounts(db: PowerSyncDatabase): Promise<Record<string, number>> {
  const counts: Record<string, number> = {}
  for (const table of Object.keys(EXPECTED_COUNTS)) {
    const row = await db.getOptional<{ total: number }>(`SELECT count(*) AS total FROM "${table}"`)
    counts[table] = row?.total ?? 0
  }
  return counts
}

/**
 * Re-reads the fixture rows by value, not just by count: a migration that
 * recreated a table and re-inserted blank rows would keep the counts and lose
 * the day's takings.
 */
async function readValues(db: PowerSyncDatabase): Promise<string> {
  for (const sale of FIXTURE.sales) {
    const row = await db.getOptional<{
      receipt_number: string
      total_minor: number
      tax_total_minor: number
      terminal_id: string
      occurred_at: string
    }>(
      'SELECT receipt_number, total_minor, tax_total_minor, terminal_id, occurred_at FROM sale WHERE id = ?',
      [sale.id],
    )
    if (!row) throw new Error(`sale ${sale.id} was lost by the migration`)
    if (row.receipt_number !== sale.receiptNumber) {
      throw new Error(`sale ${sale.id} receipt number changed to ${row.receipt_number}`)
    }
    if (row.total_minor !== sale.totalMinor || row.tax_total_minor !== sale.taxTotalMinor) {
      throw new Error(`sale ${sale.id} totals changed`)
    }
    if (row.terminal_id !== FIXTURE.terminalId || row.occurred_at !== sale.occurredAt) {
      throw new Error(`sale ${sale.id} lost its terminal or timestamp`)
    }

    const line = await db.getOptional<{ total_minor: number; quantity: number }>(
      'SELECT total_minor, quantity FROM sale_line WHERE sale_id = ?',
      [sale.id],
    )
    if (line?.total_minor !== sale.totalMinor || line?.quantity !== sale.quantity) {
      throw new Error(`sale ${sale.id} line values changed`)
    }

    const tender = await db.getOptional<{ method: string; amount_minor: number }>(
      'SELECT method, amount_minor FROM sale_tender WHERE sale_id = ?',
      [sale.id],
    )
    if (tender?.method !== 'CASH' || tender?.amount_minor !== sale.tenderMinor) {
      throw new Error(`sale ${sale.id} tender changed`)
    }
  }

  // A pending upload is the row the whole exercise protects: its payload must
  // still be byte-identical JSON, or the server would reject or misapply the sale.
  for (const row of OUTBOX_ROWS) {
    const stored = await db.getOptional<{ payload: string; status: string }>(
      'SELECT payload, status FROM outbox WHERE id = ?',
      [row.id],
    )
    if (!stored) throw new Error(`outbox row ${row.id} was lost by the migration`)
    if (stored.payload !== JSON.stringify(row.payload)) {
      throw new Error(`outbox row ${row.id} payload changed`)
    }
    if (stored.status !== 'pending') {
      throw new Error(`outbox row ${row.id} is no longer pending`)
    }
  }

  return `${FIXTURE.sales.length} sales, ${OUTBOX_ROWS.length} pending uploads, values intact`
}

const SALE_TABLE =
  PosSchema.tables.find((table) => table.name === 'sale')?.internalName ?? 'ps_data_local__sale'

async function readIndexes(db: PowerSyncDatabase): Promise<string[]> {
  const rows = await db.getAll<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? ORDER BY name",
    [SALE_TABLE],
  )
  // PowerSync creates a local-only index as `<internal table>__<declared name>`
  // (`ps_data_local__sale__sale_terminal_occurred`), so the report speaks the
  // declared names and the schema stays the single source of the index names.
  const prefix = `${SALE_TABLE}__`
  return rows.map((row) => (row.name.startsWith(prefix) ? row.name.slice(prefix.length) : row.name))
}

export async function runSchemaMigrationProof(
  options: SchemaMigrationOptions,
): Promise<SchemaMigrationReport> {
  const startedAt = performance.now()
  const vfs = options.vfs ?? WASQLiteVFS.OPFSCoopSyncVFS
  const filename = `${MIGRATION_DB_PREFIX}-${crypto.randomUUID()}.db`
  const terminalId = options.terminalId ?? FIXTURE.terminalId
  const steps: SchemaMigrationStep[] = []

  let counts: Record<string, number> = {}
  let indexes: string[] = []
  let queryPlan: string[] = []

  const record = async (name: string, work: () => Promise<string | undefined>) => {
    try {
      const detail = await withTimeout(Promise.resolve().then(work), name)
      steps.push({ name, ok: true, detail })
      return true
    } catch (error) {
      steps.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  const closeSafely = async (target: PowerSyncDatabase) => {
    try {
      await target.close()
    } catch {
      // Closing a failed handle is best effort.
    }
  }

  // --- Phase 1: a database as it exists on a terminal today -----------------
  let db = createDatabase(filename, PreviousPosSchema, options.encryptionKey, vfs)

  const opened = await record('open a database with the previous schema', async () => {
    await db.execute('SELECT 1')
    return `${filename} (vfs=${vfs})`
  })
  if (!opened) {
    await closeSafely(db)
    return {
      ok: false,
      vfs,
      database: filename,
      steps,
      counts,
      indexes,
      queryPlan,
      durationMs: Math.round(performance.now() - startedAt),
    }
  }

  const written = await record('write a day of trading', async () => {
    await writeFixtures(db)
    return 'shift, 2 sales, lines, tenders, cash movement, 3 pending outbox rows'
  })

  await record('close the previous-schema database', async () => {
    await db.close()
    return 'closed'
  })

  // --- Phase 2: the same file, the schema this build ships ------------------
  if (written) {
    db = createDatabase(filename, PosSchema, options.encryptionKey, vfs)

    const migrated = await record('reopen the same file with the current schema', async () => {
      await db.execute('SELECT 1')
      return 'migrated on open'
    })

    if (migrated) {
      await record('every row still reads', async () => {
        counts = await readCounts(db)
        const wrong = Object.entries(EXPECTED_COUNTS).filter(([table, total]) => {
          return counts[table] !== total
        })
        if (wrong.length > 0) {
          throw new Error(
            `row counts changed: ${wrong
              .map(([table, total]) => `${table} ${counts[table] ?? 0}/${total}`)
              .join(', ')}`,
          )
        }
        return Object.entries(counts)
          .map(([table, total]) => `${table}=${total}`)
          .join(' ')
      })

      await record('fixture values are unchanged', async () => readValues(db))

      await record('both older indexes survive', async () => {
        indexes = await readIndexes(db)
        for (const name of ['sale_shift', 'sale_occurred']) {
          if (!indexes.includes(name)) throw new Error(`${name} is missing after the migration`)
        }
        return indexes.join(', ')
      })

      await record('the new index exists', async () => {
        indexes = await readIndexes(db)
        if (!indexes.includes('sale_terminal_occurred')) {
          throw new Error(`sale_terminal_occurred is missing (found: ${indexes.join(', ')})`)
        }
        return 'sale_terminal_occurred'
      })

      await record('the home day-window query uses the new index', async () => {
        const rows = await db.getAll<Record<string, unknown>>(PLAN_SQL, [
          terminalId,
          FIXTURE.from,
          FIXTURE.to,
        ])
        queryPlan = rows.map((row) => String(row.detail ?? Object.values(row).join(' ')))
        if (!queryPlan.some((detail) => detail.includes('sale_terminal_occurred'))) {
          throw new Error(`query plan did not use the index: ${queryPlan.join(' | ')}`)
        }
        return queryPlan.join(' | ')
      })
    }

    await record('close the migrated database', async () => {
      await db.close()
      return 'closed'
    })
  }

  await closeSafely(db)

  return {
    ok: steps.length > 0 && steps.every((step) => step.ok),
    vfs,
    database: filename,
    steps,
    counts,
    indexes,
    queryPlan,
    durationMs: Math.round(performance.now() - startedAt),
  }
}
