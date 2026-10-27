import { db } from '@sceptre/db'
import {
  CONFLICT_RESOLUTION_CODES,
  type ConflictResolutionCode,
  EVAT_DOCUMENT_KINDS,
  EVAT_SUBMISSION_STATUSES,
  type EvatDocumentKind,
  type EvatSubmissionStatus,
  FLAG_KEYS,
  TRANSFER_STATUSES,
  type TransferStatus,
} from '@sceptre/shared'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  randomToken,
  signIn,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import {
  evatDocumentKindEnum,
  evatSubmission,
  evatSubmissionStatusEnum,
} from '../evat/evat.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import {
  supplierInvoice,
  supplierPayment,
  supplierPaymentMethodEnum,
} from '../payables/payables.schema.ts'
import {
  paymentEvent,
  supplierTransfer,
  supplierTransferAllocation,
  supplierTransferStatusEnum,
} from '../payments/payments.schema.ts'
import {
  conflictResolutionCodeEnum,
  refund,
  sale,
  shift,
  shiftReport,
  syncConflict,
} from '../pos/pos.schema.ts'
import { supplier, supplierPaymentDetail } from '../suppliers/suppliers.schema.ts'
import { setting } from './settings.schema.ts'
import { FLAG_SETTING_KEYS_ARE_EXACT, SETTING_DEFINITIONS } from './settings.validation.ts'

const available = await databaseAvailable()
if (!available)
  console.warn('[phase14-schema.test] database unavailable; integration tests skipped')

interface EnumRow {
  type_name: string
  value: string
  [key: string]: unknown
}

interface ColumnRow {
  table_name: string
  column_name: string
  is_nullable: string
  data_type: string
  udt_name: string
  [key: string]: unknown
}

interface IndexRow {
  indexname: string
  indexdef: string
  [key: string]: unknown
}

interface ConstraintRow {
  conname: string
  table_name: string
  definition: string
  [key: string]: unknown
}

/**
 * Drizzle wraps a driver error in `DrizzleQueryError`, so the PostgreSQL message
 * ("violates check constraint …") arrives on `cause`. Read both rather than
 * asserting on a wrapper that changes with the ORM version.
 */
async function rejectsWith(action: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await action
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause
    const message = `${error instanceof Error ? error.message : String(error)} ${cause?.message ?? ''}`
    expect(message).toMatch(pattern)
    return
  }
  throw new Error('expected the statement to be rejected, but it was accepted')
}

/**
 * The row or value a test asked for, or a failure that names it. A test that
 * asserts on `undefined` proves nothing, so a missing fixture is an error.
 */
function one<T>(value: T | null | undefined, label: string): T {
  if (value === null || value === undefined) throw new Error(`${label} is missing`)
  return value
}

/** The five keys this plan adds, and the shape each must resolve to. */
const PHASE14_SETTINGS = [
  { key: 'tax.sellerTin', value: '', source: 'default', writableBy: 'admin' },
  { key: 'tax.sellerVatNumber', value: '', source: 'default', writableBy: 'admin' },
  { key: 'flag.supplierTransfers', value: true, source: 'default', writableBy: 'admin' },
  { key: 'flag.evatSubmission', value: true, source: 'default', writableBy: 'admin' },
  { key: 'flag.posConflictResolution', value: true, source: 'default', writableBy: 'admin' },
] as const

const PHASE14_SETTING_KEYS = PHASE14_SETTINGS.map((item) => item.key)

describe('phase 14 vocabulary', () => {
  it('keeps each drizzle enum and its shared union the same set, in the same order', () => {
    expect([...conflictResolutionCodeEnum.enumValues]).toEqual([...CONFLICT_RESOLUTION_CODES])
    expect([...supplierTransferStatusEnum.enumValues]).toEqual([...TRANSFER_STATUSES])
    expect([...evatDocumentKindEnum.enumValues]).toEqual([...EVAT_DOCUMENT_KINDS])
    expect([...evatSubmissionStatusEnum.enumValues]).toEqual([...EVAT_SUBMISSION_STATUSES])

    // Compile-time half: if either list gains a value the other lacks, the
    // matching const below is no longer `true` and `check-types` fails.
    type ResolutionValue = (typeof conflictResolutionCodeEnum.enumValues)[number]
    const resolutionsMatch: [ResolutionValue] extends [ConflictResolutionCode]
      ? [ConflictResolutionCode] extends [ResolutionValue]
        ? true
        : false
      : false = true
    type TransferValue = (typeof supplierTransferStatusEnum.enumValues)[number]
    const transfersMatch: [TransferValue] extends [TransferStatus]
      ? [TransferStatus] extends [TransferValue]
        ? true
        : false
      : false = true
    type KindValue = (typeof evatDocumentKindEnum.enumValues)[number]
    const kindsMatch: [KindValue] extends [EvatDocumentKind]
      ? [EvatDocumentKind] extends [KindValue]
        ? true
        : false
      : false = true
    type SubmissionValue = (typeof evatSubmissionStatusEnum.enumValues)[number]
    const submissionsMatch: [SubmissionValue] extends [EvatSubmissionStatus]
      ? [EvatSubmissionStatus] extends [SubmissionValue]
        ? true
        : false
      : false = true

    expect([resolutionsMatch, transfersMatch, kindsMatch, submissionsMatch]).toEqual([
      true,
      true,
      true,
      true,
    ])
  })
})

describe('phase 14 settings', () => {
  it('registers the five keys with the intended defaults and scope', () => {
    for (const expected of PHASE14_SETTINGS) {
      const definition = SETTING_DEFINITIONS[expected.key as keyof typeof SETTING_DEFINITIONS]
      expect(definition, `${expected.key} is missing`).toBeDefined()
      expect(definition.defaultValue).toBe(expected.value)
      expect(definition.branchScoped).toBe(false)
      expect('writableBy' in definition ? definition.writableBy : 'admin').toBe(expected.writableBy)
    }
  })

  it('accepts a trimmed TIN and a boolean flag, and refuses what is not one', () => {
    const tin = SETTING_DEFINITIONS['tax.sellerTin'].schema
    expect(tin.safeParse('  C0012345678  ').success).toBe(true)
    expect(tin.safeParse('x'.repeat(30)).success).toBe(true)
    expect(tin.safeParse('x'.repeat(31)).success).toBe(false)
    expect(tin.safeParse(12).success).toBe(false)

    for (const key of [
      'flag.supplierTransfers',
      'flag.evatSubmission',
      'flag.posConflictResolution',
    ] as const) {
      const flag = SETTING_DEFINITIONS[key].schema
      expect(flag.safeParse(true).success).toBe(true)
      expect(flag.safeParse(false).success).toBe(true)
      expect(flag.safeParse('true').success).toBe(false)
      expect(flag.safeParse(1).success).toBe(false)
    }
  })

  it('keeps FLAG_KEYS and the flag settings the same set', () => {
    const flagSettings = Object.keys(SETTING_DEFINITIONS).filter((key) => key.startsWith('flag.'))
    expect(flagSettings).toEqual([...FLAG_KEYS])
    expect(FLAG_SETTING_KEYS_ARE_EXACT).toBe(true)
  })
})

describe.skipIf(!available)('phase 14 schema and constraints', () => {
  const createdUserIds: string[] = []
  let adminCookie = ''
  let managerCookie = ''
  let branchId = ''
  let terminalId = ''
  let deviceId = ''
  let shiftId = ''
  let saleId = ''
  let refundId = ''
  let supplierId = ''
  let paymentDetailId = ''
  let invoiceId = ''
  let supplierPaymentId = ''
  const transferIds: string[] = []
  const eventBodyHashes: string[] = []
  /**
   * The demo seed writes the two seller numbers; this suite asserts the honest
   * default, so the rows are held aside and put back in `afterAll`.
   */
  const priorTaxSettings: {
    key: string
    value: unknown
    branchId: string | null
    updatedBy: string | null
  }[] = []

  const now = new Date()
  const isoDay = now.toISOString().slice(0, 10)

  beforeAll(async () => {
    const seededTaxRows = await db
      .select({
        key: setting.key,
        value: setting.value,
        branchId: setting.branchId,
        updatedBy: setting.updatedBy,
      })
      .from(setting)
      .where(
        and(
          inArray(setting.key, ['tax.sellerTin', 'tax.sellerVatNumber']),
          isNull(setting.branchId),
        ),
      )
    priorTaxSettings.push(...seededTaxRows)
    if (seededTaxRows.length > 0) {
      await db.delete(setting).where(
        inArray(
          setting.key,
          seededTaxRows.map((row) => row.key),
        ),
      )
    }

    const admin = await createTestUser({ role: 'ADMIN', name: 'Phase 14 Admin' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    const created = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `P14${randomToken(1)}`,
        name: 'Phase 14 Branch',
        type: 'RETAIL',
        city: 'Accra',
      }),
    })
    expect(created.status).toBe(201)
    const body = (await created.json()) as { branch: { id: string } }
    branchId = body.branch.id

    const manager = await createTestUser({
      role: 'MANAGER',
      branchId,
      name: 'Phase 14 Manager',
    })
    createdUserIds.push(manager.id)
    managerCookie = await signIn(manager.email)

    const [createdTerminal] = await db
      .insert(terminal)
      .values({ branchId, code: `T${randomToken(4)}`, name: 'Phase 14 Terminal' })
      .returning({ id: terminal.id })
    terminalId = one(createdTerminal, 'terminal').id

    const [createdDevice] = await db
      .insert(device)
      .values({
        terminalId,
        fingerprint: `fp-${randomToken(8)}`,
        tokenHash: `th-${randomToken(8)}`,
      })
      .returning({ id: device.id })
    deviceId = one(createdDevice, 'device').id

    const [createdShift] = await db
      .insert(shift)
      .values({
        number: `SFT-P14-${randomToken(4)}`,
        branchId,
        terminalId,
        deviceId,
        cashierUserId: admin.id,
        cashierStaffId: admin.id,
        openedAt: now,
      })
      .returning({ id: shift.id })
    shiftId = one(createdShift, 'shift').id

    const [createdSale] = await db
      .insert(sale)
      .values({
        receiptNumber: `RCP-P14-${randomToken(4)}`,
        branchId,
        terminalId,
        deviceId,
        shiftId,
        clientTransactionId: crypto.randomUUID(),
        cashierUserId: admin.id,
        cashierStaffId: admin.id,
        occurredAt: now,
        subtotalMinor: 10_000,
        totalMinor: 10_000,
        tenderTotalMinor: 10_000,
        taxMode: 'INCLUSIVE',
      })
      .returning({ id: sale.id })
    saleId = one(createdSale, 'sale').id

    const [createdRefund] = await db
      .insert(refund)
      .values({
        id: crypto.randomUUID(),
        number: `RFD-P14-${randomToken(4)}`,
        saleId,
        branchId,
        terminalId,
        deviceId,
        shiftId,
        reasonCode: 'OTHER',
        refundedMinor: 1_000,
        approvedByUserId: admin.id,
        approvedByStaffId: admin.id,
        approvalPinVersion: 1,
        approvalReasonCode: 'OTHER',
        approvedAt: now,
        occurredAt: now,
      })
      .returning({ id: refund.id })
    refundId = one(createdRefund, 'refund').id

    const [createdSupplier] = await db
      .insert(supplier)
      .values({ code: `SUP${randomToken(4)}`, name: 'Phase 14 Supplier' })
      .returning({ id: supplier.id })
    supplierId = one(createdSupplier, 'supplier').id

    const [createdDetail] = await db
      .insert(supplierPaymentDetail)
      .values({
        supplierId,
        method: 'BANK',
        accountNumber: `000${randomToken(6)}`,
        bankName: 'Test Bank',
        bankCode: 'TEST',
      })
      .returning({ id: supplierPaymentDetail.id })
    paymentDetailId = one(createdDetail, 'payment detail').id

    const [createdInvoice] = await db
      .insert(supplierInvoice)
      .values({
        number: `INV-P14-${randomToken(4)}`,
        supplierId,
        branchId,
        supplierInvoiceNumber: `SUP-INV-${randomToken(4)}`,
        invoiceDate: isoDay,
        dueDate: isoDay,
        subtotalMinor: 50_000,
        totalMinor: 50_000,
      })
      .returning({ id: supplierInvoice.id })
    invoiceId = one(createdInvoice, 'invoice').id

    const [createdPayment] = await db
      .insert(supplierPayment)
      .values({
        number: `PAY-P14-${randomToken(4)}`,
        supplierId,
        branchId,
        method: 'BANK',
        amountMinor: 25_000,
        paidAt: now,
        paymentDetailId,
      })
      .returning({ id: supplierPayment.id })
    supplierPaymentId = one(createdPayment, 'supplier payment').id
  })

  afterAll(async () => {
    if (!available) return
    if (eventBodyHashes.length > 0) {
      await db.delete(paymentEvent).where(inArray(paymentEvent.bodySha256, eventBodyHashes))
    }
    if (transferIds.length > 0) {
      await db
        .delete(supplierTransferAllocation)
        .where(inArray(supplierTransferAllocation.transferId, transferIds))
      await db.delete(supplierTransfer).where(inArray(supplierTransfer.id, transferIds))
    }
    await db.delete(evatSubmission).where(eq(evatSubmission.branchId, branchId))
    await db.delete(syncConflict).where(eq(syncConflict.branchId, branchId))
    await db.delete(shiftReport).where(eq(shiftReport.branchId, branchId))
    await db.delete(refund).where(eq(refund.branchId, branchId))
    await db.delete(sale).where(eq(sale.branchId, branchId))
    await db.delete(shift).where(eq(shift.branchId, branchId))
    await db.delete(device).where(eq(device.id, deviceId))
    await db.delete(terminal).where(eq(terminal.id, terminalId))
    await db.delete(supplierPayment).where(eq(supplierPayment.id, supplierPaymentId))
    await db.delete(supplierInvoice).where(eq(supplierInvoice.id, invoiceId))
    await db.delete(supplierPaymentDetail).where(eq(supplierPaymentDetail.id, paymentDetailId))
    await db.delete(supplier).where(eq(supplier.id, supplierId))
    await db
      .delete(setting)
      .where(
        inArray(setting.key, [...PHASE14_SETTING_KEYS, 'tax.sellerTin', 'tax.sellerVatNumber']),
      )
    for (const id of createdUserIds) await deleteTestUser(id)
    if (branchId) await db.delete(branch).where(eq(branch.id, branchId))
  })

  /** A transfer row that satisfies every NOT NULL and check, so a test can bend one. */
  async function insertTransfer(overrides: Partial<typeof supplierTransfer.$inferInsert> = {}) {
    const [row] = await db
      .insert(supplierTransfer)
      .values({
        branchId,
        supplierId,
        paymentDetailId,
        method: 'BANK',
        amountMinor: 10_000,
        reference: `sdt-${crypto.randomUUID()}`,
        idempotencyKey: crypto.randomUUID(),
        provider: 'MOCK',
        reason: 'Phase 14 test transfer',
        ...overrides,
      })
      .returning({ id: supplierTransfer.id })
    const id = one(row, 'transfer').id
    transferIds.push(id)
    return id
  }

  it('creates the four enums in the order the shared unions declare', async () => {
    const typeNames = [
      'conflict_resolution_code',
      'supplier_transfer_status',
      'evat_document_kind',
      'evat_submission_status',
    ]
    const result = await db.execute<EnumRow>(
      sql`select t.typname as type_name, e.enumlabel as value
          from pg_type t
          join pg_enum e on e.enumtypid = t.oid
          join pg_namespace n on n.oid = t.typnamespace
          where n.nspname = 'public' and t.typname in ${typeNames}
          order by t.typname, e.enumsortorder`,
    )

    const byType = new Map<string, string[]>()
    for (const row of result.rows) {
      const list = byType.get(row.type_name) ?? []
      list.push(row.value)
      byType.set(row.type_name, list)
    }

    // `enumsortorder` is the order PostgreSQL accepts for a cast, so it must be
    // the order the shared list renders in, not merely the same set.
    expect(byType.get('conflict_resolution_code')).toEqual([...CONFLICT_RESOLUTION_CODES])
    expect(byType.get('supplier_transfer_status')).toEqual([...TRANSFER_STATUSES])
    expect(byType.get('evat_document_kind')).toEqual([...EVAT_DOCUMENT_KINDS])
    expect(byType.get('evat_submission_status')).toEqual([...EVAT_SUBMISSION_STATUSES])
  })

  it('adds a nullable resolution code and the newest-first queue index', async () => {
    const column = await db.execute<ColumnRow>(
      sql`select table_name, column_name, is_nullable, data_type, udt_name
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'sync_conflict'
            and column_name = 'resolution_code'`,
    )
    expect(column.rows).toHaveLength(1)
    const row = one(column.rows[0], 'resolution_code column')
    expect(row.is_nullable).toBe('YES')
    expect(row.data_type).toBe('USER-DEFINED')
    expect(row.udt_name).toBe('conflict_resolution_code')

    const indexes = await db.execute<IndexRow>(
      sql`select indexname, indexdef from pg_indexes where schemaname = 'public'`,
    )
    const index = indexes.rows.find((item) => item.indexname === 'sync_conflict_status_created_idx')
    expect(index).toBeDefined()
    expect(one(index, 'queue index').indexdef).toContain('status')
    expect(one(index, 'queue index').indexdef).toContain('created_at DESC')

    // A conflict can be recorded without a resolution and later closed with a
    // code; the column is the record, and it never rewrites the sale.
    const [conflict] = await db
      .insert(syncConflict)
      .values({
        branchId,
        terminalId,
        deviceId,
        saleId,
        type: 'STOCK_OVERSELL',
        severity: 'LOW',
        details: { productId: null },
      })
      .returning({ id: syncConflict.id, resolutionCode: syncConflict.resolutionCode })
    expect(one(conflict, 'conflict').resolutionCode).toBeNull()

    await db
      .update(syncConflict)
      .set({ resolutionCode: 'CONFIRMED', status: 'RESOLVED' })
      .where(eq(syncConflict.id, one(conflict, 'conflict').id))
    const [resolved] = await db
      .select({ resolutionCode: syncConflict.resolutionCode })
      .from(syncConflict)
      .where(eq(syncConflict.id, one(conflict, 'conflict').id))
    expect(one(resolved, 'resolved conflict').resolutionCode).toBe('CONFIRMED')
  })

  it('makes cash_refund_minor nullable so an old snapshot says "not itemised"', async () => {
    const column = await db.execute<ColumnRow>(
      sql`select table_name, column_name, is_nullable, data_type
          from information_schema.columns
          where table_schema = 'public'
            and table_name = 'shift_report'
            and column_name = 'cash_refund_minor'`,
    )
    expect(column.rows).toHaveLength(1)
    expect(one(column.rows[0], 'cash_refund_minor').is_nullable).toBe('YES')
    expect(one(column.rows[0], 'cash_refund_minor').data_type).toBe('integer')

    const [report] = await db
      .insert(shiftReport)
      .values({
        shiftId,
        branchId,
        terminalId,
        deviceId,
        number: `Z-P14-${randomToken(4)}`,
        openedAt: now,
        closedAt: now,
      })
      .returning({ id: shiftReport.id, cashRefundMinor: shiftReport.cashRefundMinor })
    expect(one(report, 'shift report').cashRefundMinor).toBeNull()
  })

  it('creates the transfer tables with the columns, checks and uniques they need', async () => {
    const result = await db.execute<ColumnRow>(
      sql`select table_name, column_name, is_nullable, data_type, udt_name
          from information_schema.columns
          where table_schema = 'public'
            and table_name in ('supplier_transfer', 'supplier_transfer_allocation', 'payment_event')`,
    )
    const columns = new Map(result.rows.map((row) => [`${row.table_name}.${row.column_name}`, row]))

    const expected: Record<string, readonly string[]> = {
      supplier_transfer: [
        'branch_id',
        'supplier_id',
        'payment_detail_id',
        'method',
        'amount_minor',
        'reference',
        'idempotency_key',
        'status',
        'provider',
        'recipient_code',
        'provider_transfer_code',
        'provider_transfer_id',
        'reason',
        'note',
        'failure_code',
        'failure_message',
        'payment_id',
        'unallocated_minor',
        'initiated_by',
        'finalized_at',
        'settled_at',
        'last_verified_at',
      ],
      supplier_transfer_allocation: ['transfer_id', 'invoice_id', 'amount_minor'],
      payment_event: ['supplier_transfer_id'],
    }
    for (const [table, names] of Object.entries(expected)) {
      for (const name of names) {
        expect(columns.has(`${table}.${name}`), `${table}.${name} is missing`).toBe(true)
      }
    }

    // Every non-null column the plan names, so a later edit cannot quietly make
    // the amount or the reference optional.
    for (const name of [
      'supplier_id',
      'payment_detail_id',
      'method',
      'amount_minor',
      'reference',
      'idempotency_key',
      'status',
      'provider',
      'reason',
      'unallocated_minor',
    ]) {
      expect(
        one(columns.get(`supplier_transfer.${name}`), name).is_nullable,
        `supplier_transfer.${name} must be NOT NULL`,
      ).toBe('NO')
    }

    expect(
      one(columns.get('payment_event.supplier_transfer_id'), 'payment_event link').is_nullable,
    ).toBe('YES')
    expect(
      one(columns.get('payment_event.supplier_transfer_id'), 'payment_event link').udt_name,
    ).toBe('uuid')
    expect(one(columns.get('supplier_transfer.status'), 'transfer status').udt_name).toBe(
      'supplier_transfer_status',
    )
    expect(one(columns.get('supplier_transfer.provider'), 'transfer provider').udt_name).toBe(
      'payment_provider',
    )
    expect(one(columns.get('supplier_transfer.method'), 'transfer method').udt_name).toBe(
      'supplier_payment_method',
    )
    expect(
      (supplierPaymentMethodEnum.enumValues as readonly string[]).includes('CASH'),
      'CASH must stay in the shared enum and be refused by the service, not the type',
    ).toBe(true)

    const constraints = await db.execute<ConstraintRow>(
      sql`select conname, conrelid::regclass::text as table_name,
                 pg_get_constraintdef(oid) as definition
          from pg_constraint
          where connamespace = 'public'::regnamespace
            and conrelid::regclass::text in ('supplier_transfer', 'supplier_transfer_allocation')`,
    )
    const byName = new Map(constraints.rows.map((row) => [row.conname, row.definition]))
    expect(byName.get('supplier_transfer_amount_positive')).toContain('amount_minor > 0')
    expect(byName.get('supplier_transfer_reference_length')).toContain('char_length')
    expect(byName.get('supplier_transfer_allocation_amount_positive')).toContain('amount_minor > 0')

    const indexes = await db.execute<IndexRow>(
      sql`select indexname, indexdef from pg_indexes
          where schemaname = 'public'
            and tablename in ('supplier_transfer', 'supplier_transfer_allocation', 'payment_event')`,
    )
    const indexByName = new Map(indexes.rows.map((row) => [row.indexname, row.indexdef]))
    expect(indexByName.get('supplier_transfer_reference_unique')).toContain('UNIQUE INDEX')
    expect(indexByName.get('supplier_transfer_idempotency_unique')).toContain('UNIQUE INDEX')
    expect(indexByName.get('supplier_transfer_idempotency_unique')).toContain('branch_id')
    const settled = indexByName.get('supplier_transfer_payment_unique')
    expect(settled).toContain('UNIQUE INDEX')
    expect(settled).toContain('payment_id IS NOT NULL')
    const allocation = indexByName.get('supplier_transfer_allocation_transfer_invoice_unique')
    expect(allocation).toContain('UNIQUE INDEX')
    expect(allocation).toContain('transfer_id')
    expect(allocation).toContain('invoice_id')
    expect(indexByName.get('payment_event_transfer_idx')).toContain('supplier_transfer_id')
  })

  it('refuses a zero amount, a short reference, and a duplicate idempotency key', async () => {
    await rejectsWith(
      insertTransfer({ amountMinor: 0 }),
      /supplier_transfer_amount_positive|violates check constraint/,
    )
    await rejectsWith(
      insertTransfer({ reference: 'sdt-short' }),
      /supplier_transfer_reference_length|violates check constraint/,
    )
    await rejectsWith(
      insertTransfer({ reference: `sdt-${'a'.repeat(60)}` }),
      /supplier_transfer_reference_length|violates check constraint/,
    )

    // The reference is ours and server-minted; two transfers cannot share one,
    // because Paystack's idempotency is keyed on it.
    const reference = `sdt-${crypto.randomUUID()}`
    await insertTransfer({ reference })
    await rejectsWith(
      insertTransfer({ reference }),
      /supplier_transfer_reference_unique|duplicate key value/,
    )

    const key = crypto.randomUUID()
    await insertTransfer({ idempotencyKey: key })
    await rejectsWith(
      insertTransfer({ idempotencyKey: key }),
      /supplier_transfer_idempotency_unique|duplicate key value/,
    )
  })

  it('settles one transfer per payment and one payment per transfer', async () => {
    await insertTransfer({ paymentId: supplierPaymentId })
    await rejectsWith(
      insertTransfer({ paymentId: supplierPaymentId }),
      /supplier_transfer_payment_unique|duplicate key value/,
    )
  })

  it('refuses a second allocation for the same transfer and invoice', async () => {
    const transferId = await insertTransfer()
    await db
      .insert(supplierTransferAllocation)
      .values({ transferId, invoiceId, amountMinor: 5_000 })
    await rejectsWith(
      db.insert(supplierTransferAllocation).values({ transferId, invoiceId, amountMinor: 1_000 }),
      /supplier_transfer_allocation_transfer_invoice_unique|duplicate key value/,
    )
    // A second transfer, so the zero amount is the only thing wrong with the row:
    // the check must reject it on its own, not because the pair already existed.
    const otherTransferId = await insertTransfer()
    await rejectsWith(
      db
        .insert(supplierTransferAllocation)
        .values({ transferId: otherTransferId, invoiceId, amountMinor: 0 }),
      /supplier_transfer_allocation_amount_positive|violates check constraint/,
    )
  })

  it('nulls the event link when a transfer row goes away', async () => {
    const transferId = await insertTransfer()
    const bodySha256 = randomToken(16)
    eventBodyHashes.push(bodySha256)
    const [event] = await db
      .insert(paymentEvent)
      .values({
        provider: 'MOCK',
        eventType: 'transfer.success',
        bodySha256,
        supplierTransferId: transferId,
        status: 'IGNORED',
      })
      .returning({ id: paymentEvent.id })
    expect(event).toBeDefined()

    await db.delete(supplierTransfer).where(eq(supplierTransfer.id, transferId))
    transferIds.splice(transferIds.indexOf(transferId), 1)

    const [reread] = await db
      .select({ supplierTransferId: paymentEvent.supplierTransferId })
      .from(paymentEvent)
      .where(eq(paymentEvent.bodySha256, bodySha256))
    expect(one(reread, 'payment event').supplierTransferId).toBeNull()
  })

  it('creates evat_submission with the certificate fields and the queue index', async () => {
    const result = await db.execute<ColumnRow>(
      sql`select table_name, column_name, is_nullable, data_type, udt_name
          from information_schema.columns
          where table_schema = 'public' and table_name = 'evat_submission'`,
    )
    const columns = new Map(result.rows.map((row) => [row.column_name, row]))

    for (const name of [
      'kind',
      'branch_id',
      'terminal_id',
      'sale_id',
      'refund_id',
      'status',
      'attempts',
      'next_attempt_at',
      'due_at',
      'provider',
      'provider_invoice_number',
      'sdc_id',
      'serial',
      'signature',
      'internal_data',
      'machine_code',
      'stamped_at',
      'qr_payload',
      'last_error_code',
      'last_error_message',
      'submitted_at',
      'certified_at',
    ]) {
      expect(columns.has(name), `evat_submission.${name} is missing`).toBe(true)
    }
    expect(one(columns.get('sale_id'), 'sale_id').is_nullable).toBe('YES')
    expect(one(columns.get('refund_id'), 'refund_id').is_nullable).toBe('YES')
    expect(one(columns.get('kind'), 'kind').udt_name).toBe('evat_document_kind')
    expect(one(columns.get('status'), 'status').udt_name).toBe('evat_submission_status')

    const indexes = await db.execute<IndexRow>(
      sql`select indexname, indexdef from pg_indexes
          where schemaname = 'public' and tablename = 'evat_submission'`,
    )
    const indexByName = new Map(indexes.rows.map((row) => [row.indexname, row.indexdef]))
    expect(indexByName.get('evat_submission_queue_idx')).toContain('next_attempt_at')
    expect(indexByName.get('evat_submission_sale_unique')).toContain('sale_id IS NOT NULL')
    expect(indexByName.get('evat_submission_refund_unique')).toContain('refund_id IS NOT NULL')
  })

  it('refuses a submission with both documents, with neither, and a second for one sale', async () => {
    const base = {
      branchId,
      terminalId,
      dueAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      provider: 'MOCK',
    }

    // Neither document: a row that would never be certifiable.
    await rejectsWith(
      db.insert(evatSubmission).values({ ...base, kind: 'INVOICE' }),
      /evat_submission_document_xor|violates check constraint/,
    )
    // Both documents: the kind would be a lie either way.
    await rejectsWith(
      db.insert(evatSubmission).values({ ...base, kind: 'INVOICE', saleId, refundId }),
      /evat_submission_document_xor|violates check constraint/,
    )
    // A refund kind naming only a sale is the same lie from the other side.
    await rejectsWith(
      db.insert(evatSubmission).values({ ...base, kind: 'REFUND', saleId }),
      /evat_submission_document_xor|violates check constraint/,
    )

    const [invoice] = await db
      .insert(evatSubmission)
      .values({ ...base, kind: 'INVOICE', saleId })
      .returning({ id: evatSubmission.id })
    expect(invoice).toBeDefined()

    // A sale has one certificate; a second row is a second certificate for the
    // same invoice, which GRA answers with `E700` (P14-D35).
    await rejectsWith(
      db.insert(evatSubmission).values({ ...base, kind: 'INVOICE', saleId }),
      /evat_submission_sale_unique|duplicate key value/,
    )

    const [creditNote] = await db
      .insert(evatSubmission)
      .values({ ...base, kind: 'REFUND', refundId })
      .returning({ id: evatSubmission.id })
    expect(creditNote).toBeDefined()
    await rejectsWith(
      db.insert(evatSubmission).values({ ...base, kind: 'REFUND', refundId }),
      /evat_submission_refund_unique|duplicate key value/,
    )
  })

  it('resolves the five settings with their defaults, scope and writer', async () => {
    const response = await app.request('/api/settings', { headers: authedHeaders(adminCookie) })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      settings: { key: string; value: unknown; source: string; writableBy: string }[]
    }

    for (const expected of PHASE14_SETTINGS) {
      const found = one(
        body.settings.find((item) => item.key === expected.key),
        expected.key,
      )
      expect(found.value, `${expected.key} has the wrong value`).toEqual(expected.value)
      expect(found.source, `${expected.key} has the wrong source`).toBe(expected.source)
      expect(found.writableBy, `${expected.key} has the wrong writer`).toBe(expected.writableBy)
    }
  })

  it('refuses a manager write to every one of the five keys', async () => {
    const attempts: Record<string, unknown> = {
      'tax.sellerTin': 'C0099999999',
      'tax.sellerVatNumber': 'C0099999999',
      'flag.supplierTransfers': false,
      'flag.evatSubmission': false,
      'flag.posConflictResolution': false,
    }

    for (const [key, value] of Object.entries(attempts)) {
      const denied = await app.request('/api/settings', {
        method: 'PATCH',
        headers: authedHeaders(managerCookie),
        body: JSON.stringify({ key, value, branchId }),
      })
      expect(denied.status, `${key} should be admin-only`).toBe(403)
    }

    const rows = await db
      .select({ key: setting.key })
      .from(setting)
      .where(inArray(setting.key, PHASE14_SETTING_KEYS))
    expect(rows).toHaveLength(0)
  })

  it('lets an admin write the seller TIN and resolves it as a global value', async () => {
    const allowed = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ key: 'tax.sellerTin', value: '  C0012345678  ' }),
    })
    expect(allowed.status).toBe(200)

    const scoped = await app.request('/api/settings', { headers: authedHeaders(adminCookie) })
    const body = (await scoped.json()) as {
      settings: { key: string; value: unknown; source: string }[]
    }
    const tin = body.settings.find((item) => item.key === 'tax.sellerTin')
    expect(tin?.value).toBe('C0012345678')
    expect(tin?.source).toBe('global')
  })
})
