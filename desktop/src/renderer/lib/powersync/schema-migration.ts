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
 *      that the home screen's day window plans through the new index, that the
 *      split-tender columns and index arrived, and that every table Plan 08 added
 *      takes a row.
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
 * FROZEN — `sale_tender` as it shipped before Phase 13.
 *
 * Split tender adds `sequence`, `payment_id` and `provider_reference` to a table
 * every terminal already has rows in, so the proof has to start from the *old*
 * shape. Building the previous schema from the current table would put the new
 * columns in the "before" database too and silently prove nothing (P10-D15).
 */
const previousSaleTender = new Table(
  {
    sale_id: column.text,
    method: column.text,
    amount_minor: column.integer,
    reference: column.text,
    created_at: column.text,
  },
  { localOnly: true, indexes: { sale_tender_sale: ['sale_id'] } },
).copyWithName('sale_tender')

/**
 * The previous local schema: every current table, with the two frozen tables
 * that changed under proof.
 *
 * Everything else is taken from `PosSchema.tables` (already-resolved tables), so
 * a new table added to `schema.ts` is created by the migration and the only
 * differences under proof stay the ones this phase caused: `sale`'s index and
 * `sale_tender`'s three new columns.
 */
export const PreviousPosSchema = new Schema(
  PosSchema.tables.map((table) => {
    if (table.name === 'sale') return previousSale
    if (table.name === 'sale_tender') return previousSaleTender
    return table
  }),
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

/**
 * One row per table Plan 08 added or changed, written **after** the migration.
 *
 * The previous schema already declares the new tables (it is built from the
 * current one), so this is not a table-creation proof; what it proves is that
 * the shipped schema and every declared index exist and take a row in the same
 * database that just carried a day of trading.
 */
const NEW_TABLE_FIXTURES: ReadonlyArray<{
  table: string
  columns: readonly string[]
  values: readonly unknown[]
  index: string
}> = [
  {
    table: 'cart_tender',
    columns: ['draft_id', 'sequence', 'method', 'amount_minor', 'status', 'created_at'],
    values: ['draft-migration-01', 1, 'MOMO', 5_000, 'PENDING', FIXTURE.from],
    index: 'cart_tender_draft',
  },
  {
    table: 'held_cart',
    columns: ['label', 'held_at', 'item_count', 'total_minor'],
    values: ['Brake pads for Kofi', FIXTURE.from, 2, 11_520],
    index: 'held_cart_held_at',
  },
  {
    table: 'held_cart_line',
    columns: ['hold_id', 'line_number', 'product_id', 'quantity', 'unit_price_minor'],
    values: ['hold-migration-01', 1, 'product-migration-01', 2, 4_800],
    index: 'held_cart_line_hold',
  },
  {
    table: 'cart_void',
    columns: ['shift_id', 'reason_code', 'item_count', 'gross_minor', 'occurred_at'],
    values: [FIXTURE.shiftId, 'CUSTOMER_LEFT', 1, 4_800, FIXTURE.from],
    index: 'cart_void_created',
  },
  {
    table: 'refund',
    columns: ['number', 'sale_id', 'shift_id', 'refunded_minor', 'occurred_at'],
    values: ['RF-MIG-01', 'sale-migration-01', FIXTURE.shiftId, 5_760, FIXTURE.from],
    index: 'refund_sale',
  },
  {
    table: 'refund_line',
    columns: ['refund_id', 'sale_line_id', 'quantity', 'restock'],
    values: ['refund-migration-01', 'sale-migration-01-line-1', 1, 'RESALABLE'],
    index: 'refund_line_sale_line',
  },
  {
    table: 'refund_tender',
    columns: ['refund_id', 'sequence', 'method', 'amount_minor', 'status'],
    values: ['refund-migration-01', 1, 'CASH', 5_760, 'SETTLED'],
    index: 'refund_tender_refund',
  },
  {
    table: 'shift_report',
    columns: ['shift_id', 'branch_id', 'terminal_id', 'number', 'closed_at'],
    values: [FIXTURE.shiftId, FIXTURE.branchId, FIXTURE.terminalId, 'SHIFT-MIG-01', FIXTURE.to],
    index: 'shift_report_shift',
  },
] as const

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

    const tender = await db.getOptional<{
      method: string
      amount_minor: number
      sequence: number | null
      payment_id: string | null
    }>('SELECT method, amount_minor, sequence, payment_id FROM sale_tender WHERE sale_id = ?', [
      sale.id,
    ])
    if (tender?.method !== 'CASH' || tender?.amount_minor !== sale.tenderMinor) {
      throw new Error(`sale ${sale.id} tender changed`)
    }
    // The row was written without these columns, so a null proves the migration
    // added them instead of the "previous" database already having them.
    if (tender?.sequence !== null || tender?.payment_id !== null) {
      throw new Error(`sale ${sale.id} tender gained values the old schema never wrote`)
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

function internalName(declared: string): string {
  return (
    PosSchema.tables.find((table) => table.name === declared)?.internalName ??
    `ps_data_local__${declared}`
  )
}

async function readIndexes(db: PowerSyncDatabase, declared = 'sale'): Promise<string[]> {
  const table = declared === 'sale' ? SALE_TABLE : internalName(declared)
  const rows = await db.getAll<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? ORDER BY name",
    [table],
  )
  // PowerSync creates a local-only index as `<internal table>__<declared name>`
  // (`ps_data_local__sale__sale_terminal_occurred`), so the report speaks the
  // declared names and the schema stays the single source of the index names.
  const prefix = `${table}__`
  return rows.map((row) => (row.name.startsWith(prefix) ? row.name.slice(prefix.length) : row.name))
}

/** Writes and re-reads one row in every table this plan added or changed. */
async function writeNewTableFixtures(db: PowerSyncDatabase): Promise<string> {
  await db.writeTransaction(async (tx) => {
    for (const fixture of NEW_TABLE_FIXTURES) {
      await tx.execute(insertSql(fixture.table, fixture.columns), [
        `${fixture.table}-migration-01`,
        ...fixture.values,
      ])
    }
  })

  for (const fixture of NEW_TABLE_FIXTURES) {
    const row = await db.getOptional<{ total: number }>(
      `SELECT count(*) AS total FROM "${fixture.table}"`,
    )
    if ((row?.total ?? 0) !== 1) throw new Error(`${fixture.table} did not accept a row`)

    const indexes = await readIndexes(db, fixture.table)
    if (!indexes.includes(fixture.index)) {
      throw new Error(`${fixture.index} is missing (found: ${indexes.join(', ') || 'none'})`)
    }
  }

  const tender = await db.getOptional<{ amount_minor: number; sequence: number }>(
    'SELECT amount_minor, sequence FROM sale_tender WHERE id = ?',
    ['sale-migration-01-tender-1'],
  )
  if (tender?.sequence !== null) {
    throw new Error('the old tender row gained a sequence the fixture never wrote')
  }

  return `${NEW_TABLE_FIXTURES.length} new tables, indexed and writable`
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

      await record('the split-tender index exists', async () => {
        const tenderIndexes = await readIndexes(db, 'sale_tender')
        if (!tenderIndexes.includes('sale_tender_sale_sequence')) {
          throw new Error(
            `sale_tender_sale_sequence is missing (found: ${tenderIndexes.join(', ') || 'none'})`,
          )
        }
        return tenderIndexes.join(', ')
      })

      await record('every new local table takes a row', async () => writeNewTableFixtures(db))
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
