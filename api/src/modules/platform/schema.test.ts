import { db } from '@sceptre/db'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, describe, expect, it } from 'vitest'
import { databaseAvailable, randomToken } from '../../../test/integration.ts'
import { branch } from '../org/branches.schema.ts'
import { documentSequence } from './sequences.schema.ts'
import { allocateDocumentNumber } from './sequences.service.ts'
import { setting } from './settings.schema.ts'
import { SETTING_DEFINITIONS } from './settings.validation.ts'

const available = await databaseAvailable()
if (!available) console.warn('[schema.test] database unavailable; integration tests skipped')

interface ColumnRow {
  table_name: string
  column_name: string
  [key: string]: unknown
}

interface EnumRow {
  type_name: string
  value: string
  [key: string]: unknown
}

interface IndexRow {
  indexname: string
  indexdef: string
  [key: string]: unknown
}

/**
 * The Phase 12 schema contract (Plan 02). These assertions are the migration
 * test: a fresh database must contain every column, enum value and index the
 * later plans read, or they fail at boot rather than in a walkthrough.
 */
describe.skipIf(!available)('phase 12 schema, enums and indexes', () => {
  const createdBranchIds: string[] = []

  afterAll(async () => {
    if (createdBranchIds.length > 0) {
      await db.delete(documentSequence).where(inArray(documentSequence.branchId, createdBranchIds))
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
    await db.delete(setting).where(eq(setting.key, 'inventory.writeOffPrefix'))
  })

  it('adds every column the phase reads', async () => {
    const result = await db.execute<ColumnRow>(
      sql`select table_name, column_name from information_schema.columns where table_schema = 'public'`,
    )
    const columns = new Set(result.rows.map((row) => `${row.table_name}.${row.column_name}`))

    const expected: Record<string, readonly string[]> = {
      approval: ['decider_role', 'decider_branch_id'],
      stock_count: [
        'count_type',
        'scope',
        'scope_key',
        'due_at',
        'assigned_to',
        'schedule_id',
        'trigger_reason',
        'trigger_product_id',
        'trigger_source_id',
      ],
      shift: ['review_status', 'reviewed_by', 'reviewed_at', 'review_note'],
      count_schedule: [
        'branch_id',
        'scope',
        'scope_key',
        'frequency',
        'next_due_at',
        'assigned_to',
        'is_active',
        'created_by',
        'created_at',
        'updated_at',
      ],
      stock_abc_class: [
        'product_id',
        'branch_id',
        'class',
        'value_minor',
        'sold_minor',
        'score',
        'computed_at',
        'is_manual',
        'updated_by',
        'updated_at',
      ],
      stock_write_off: [
        'number',
        'branch_id',
        'status',
        'note',
        'value_minor',
        'approval_id',
        'requested_by',
        'posted_at',
        'created_by',
        'created_at',
        'updated_at',
        'cancelled_by',
        'cancelled_at',
      ],
      stock_write_off_line: [
        'write_off_id',
        'product_id',
        'quantity',
        'unit_cost_minor',
        'reason',
        'note',
      ],
    }

    for (const [table, names] of Object.entries(expected)) {
      for (const name of names) {
        expect(columns.has(`${table}.${name}`), `${table}.${name} is missing`).toBe(true)
      }
    }
  })

  it('adds every enum value the phase writes', async () => {
    const result = await db.execute<EnumRow>(
      sql`select t.typname as type_name, e.enumlabel as value
          from pg_type t
          join pg_enum e on e.enumtypid = t.oid
          join pg_namespace n on n.oid = t.typnamespace
          where n.nspname = 'public'`,
    )
    const values = new Set(result.rows.map((row) => `${row.type_name}.${row.value}`))

    const expected: Record<string, readonly string[]> = {
      transfer_status: ['REQUESTED', 'APPROVED', 'REJECTED', 'DRAFT', 'DISPATCHED'],
      stock_movement_type: ['WRITE_OFF'],
      stock_movement_reference: ['WRITE_OFF'],
      stock_adjustment_reason: ['THEFT', 'OBSOLESCENCE', 'SUPPLIER_FAULT'],
      stock_write_off_status: ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'CANCELLED'],
      stock_write_off_reason: [
        'DAMAGE',
        'EXPIRY',
        'OBSOLESCENCE',
        'THEFT',
        'SUPPLIER_FAULT',
        'OTHER',
      ],
      count_scope: ['CATEGORY', 'BRAND', 'ABC_CLASS', 'ROTATION'],
      count_frequency: ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL'],
      count_type: ['MANUAL', 'SCHEDULED', 'TRIGGER'],
      count_trigger_reason: ['VARIANCE', 'OVERSELL'],
      abc_class: ['A', 'B', 'C'],
      shift_review_status: ['NONE', 'REQUIRED', 'REVIEWED'],
    }

    for (const [type, names] of Object.entries(expected)) {
      for (const name of names) {
        expect(values.has(`${type}.${name}`), `${type}.${name} is missing`).toBe(true)
      }
    }
  })

  it('creates the partial unique indexes and the new read indexes', async () => {
    const result = await db.execute<IndexRow>(
      sql`select indexname, indexdef from pg_indexes where schemaname = 'public'`,
    )
    const indexes = new Map(result.rows.map((row) => [row.indexname, row.indexdef]))

    const trigger = indexes.get('stock_count_open_trigger_unique')
    expect(trigger).toBeDefined()
    expect(trigger).toContain('UNIQUE INDEX')
    expect(trigger).toContain('WHERE')
    expect(trigger).toContain('trigger_product_id IS NOT NULL')
    expect(trigger).toContain('OPEN')

    const schedule = indexes.get('stock_count_open_schedule_unique')
    expect(schedule).toBeDefined()
    expect(schedule).toContain('UNIQUE INDEX')
    expect(schedule).toContain('WHERE')
    expect(schedule).toContain('schedule_id IS NOT NULL')
    expect(schedule).toContain('OPEN')

    for (const name of [
      'approval_decider_idx',
      'shift_review_idx',
      'sync_conflict_type_created_idx',
    ]) {
      expect(indexes.has(name), `${name} is missing`).toBe(true)
    }
  })

  it('defines the six phase 12 settings with their defaults and scope', () => {
    const expected = [
      {
        key: 'pricing.managerBandPercent',
        defaultValue: 10,
        branchScoped: false,
        writableBy: 'admin',
      },
      {
        key: 'pos.shiftVarianceToleranceMinor',
        defaultValue: 2_000,
        branchScoped: true,
        writableBy: 'admin',
      },
      {
        key: 'inventory.countVarianceToleranceMinor',
        defaultValue: 1_000,
        branchScoped: true,
        writableBy: 'admin',
      },
      {
        key: 'inventory.writeOffPrefix',
        defaultValue: 'WO',
        branchScoped: false,
        writableBy: 'admin',
      },
      {
        key: 'inventory.abcAThresholdBp',
        defaultValue: 8_000,
        branchScoped: false,
        writableBy: 'admin',
      },
      {
        key: 'inventory.abcBThresholdBp',
        defaultValue: 9_500,
        branchScoped: false,
        writableBy: 'admin',
      },
    ] as const

    for (const item of expected) {
      expect(SETTING_DEFINITIONS[item.key], `${item.key} is missing`).toMatchObject({
        defaultValue: item.defaultValue,
        branchScoped: item.branchScoped,
        writableBy: item.writableBy,
      })
      expect(SETTING_DEFINITIONS[item.key].schema.safeParse(item.defaultValue).success).toBe(true)
    }
  })

  it('allocates a write-off number per branch per month', async () => {
    // The prefix setting is global; a stray row would make the assertion depend
    // on test order rather than on the shipped default.
    await db.delete(setting).where(eq(setting.key, 'inventory.writeOffPrefix'))

    const code = `T${randomToken(3)}`
    const rows = await db
      .insert(branch)
      .values({
        code,
        name: 'Schema Test Branch',
        type: 'RETAIL',
        city: 'Accra',
        createdBy: 'test',
      })
      .returning({ id: branch.id })
    const branchId = rows[0]?.id
    expect(branchId).toBeDefined()
    if (!branchId) return
    createdBranchIds.push(branchId)

    const now = new Date('2026-10-26T12:00:00.000Z')
    const first = await allocateDocumentNumber('stock_write_off', branchId, db, now)
    const second = await allocateDocumentNumber('stock_write_off', branchId, db, now)

    expect(first.number).toBe(`WO-${code}-202610-0001`)
    expect(second.number).toBe(`WO-${code}-202610-0002`)
  })
})
