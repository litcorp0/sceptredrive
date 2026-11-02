import { db } from '@sceptre/db'
import { eq, inArray, sql } from 'drizzle-orm'
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
import { parseEnv } from '../../config/env.ts'
import { branch } from '../org/branches.schema.ts'
import { syncConflictTypeEnum } from '../pos/pos.schema.ts'
import type { SyncConflictType } from '../pos/pos.types.ts'
import { setting } from './settings.schema.ts'
import { SETTING_DEFINITIONS } from './settings.validation.ts'

const available = await databaseAvailable()
if (!available)
  console.warn('[phase13-schema.test] database unavailable; integration tests skipped')

interface EnumRow {
  type_name: string
  value: string
  [key: string]: unknown
}

interface ColumnRow {
  table_name: string
  column_name: string
  [key: string]: unknown
}

interface IndexRow {
  indexname: string
  indexdef: string
  [key: string]: unknown
}

interface ForeignKeyRow {
  table_name: string
  column_name: string
  [key: string]: unknown
}

const baseEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  BETTER_AUTH_SECRET: 'x'.repeat(32),
}

describe('payment environment', () => {
  it('boots in mock mode with no credentials and no provider configuration', () => {
    const parsed = parseEnv({ ...baseEnv })
    expect(parsed.PAYSTACK_MODE).toBe('mock')
    expect(parsed.PAYSTACK_BASE_URL).toBe('https://api.paystack.co')
    expect(parsed.PAYSTACK_EMAIL_DOMAIN).toBe('sceptre-drive.example')
    expect(parsed.PAYSTACK_SECRET_KEY).toBeUndefined()
  })

  it('refuses test mode without a secret key and names the variable', () => {
    expect(() => parseEnv({ ...baseEnv, PAYSTACK_MODE: 'test' })).toThrow(/PAYSTACK_SECRET_KEY/)
  })

  it('refuses live mode outside production', () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        PAYSTACK_MODE: 'live',
        PAYSTACK_SECRET_KEY: 'sk_live_test',
      }),
    ).toThrow(/PAYSTACK_MODE/)
  })

  it('accepts live mode in production with a live key and an owned email domain', () => {
    const parsed = parseEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      PAYSTACK_MODE: 'live',
      PAYSTACK_SECRET_KEY: 'sk_live_test',
      PAYSTACK_WEBHOOK_SECRET: 'sk_live_test',
      PAYSTACK_EMAIL_DOMAIN: 'sceptre-drive.com',
    })
    expect(parsed.PAYSTACK_MODE).toBe('live')
    expect(parsed.PAYSTACK_WEBHOOK_SECRET).toBe('sk_live_test')
  })

  it('accepts test mode with an sk_test key and no webhook secret', () => {
    const parsed = parseEnv({
      ...baseEnv,
      PAYSTACK_MODE: 'test',
      PAYSTACK_SECRET_KEY: 'sk_test_real_key',
      PAYSTACK_EMAIL_DOMAIN: 'sceptre-drive.com',
    })
    expect(parsed.PAYSTACK_MODE).toBe('test')
    expect(parsed.PAYSTACK_WEBHOOK_SECRET).toBeUndefined()
  })

  it('refuses a key whose prefix contradicts the mode', () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        PAYSTACK_MODE: 'test',
        PAYSTACK_SECRET_KEY: 'sk_live_real_key',
      }),
    ).toThrow(/must start with 'sk_test_'/)
    expect(() =>
      parseEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        PAYSTACK_MODE: 'live',
        PAYSTACK_SECRET_KEY: 'sk_test_real_key',
        PAYSTACK_EMAIL_DOMAIN: 'sceptre-drive.com',
      }),
    ).toThrow(/must start with 'sk_live_'/)
  })

  it('refuses a webhook secret that is not the Paystack secret key', () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        PAYSTACK_MODE: 'test',
        PAYSTACK_SECRET_KEY: 'sk_test_real_key',
        PAYSTACK_WEBHOOK_SECRET: 'whsec_something_else',
      }),
    ).toThrow(/PAYSTACK_WEBHOOK_SECRET/)
  })

  it('accepts an empty webhook secret and an empty mode as the documented defaults', () => {
    const parsed = parseEnv({
      ...baseEnv,
      PAYSTACK_MODE: '',
      PAYSTACK_SECRET_KEY: 'sk_test_real_key',
    })
    expect(parsed.PAYSTACK_MODE).toBe('mock')
    expect(parsed.PAYSTACK_WEBHOOK_SECRET).toBeUndefined()
  })

  it('refuses the .example email placeholder in live mode', () => {
    expect(() =>
      parseEnv({
        ...baseEnv,
        NODE_ENV: 'production',
        PAYSTACK_MODE: 'live',
        PAYSTACK_SECRET_KEY: 'sk_live_real_key',
        PAYSTACK_EMAIL_DOMAIN: 'sceptre-drive.example',
      }),
    ).toThrow(/PAYSTACK_EMAIL_DOMAIN/)
  })
})

describe('refund approval threshold setting', () => {
  it('is branch-overridable, admin-writable, and defaults to GH₵200', () => {
    const definition = SETTING_DEFINITIONS['pos.refundApprovalThresholdMinor']
    expect(definition).toMatchObject({
      defaultValue: 20_000,
      branchScoped: true,
      writableBy: 'admin',
    })
    expect(definition.schema.safeParse(20_000).success).toBe(true)
    expect(definition.schema.safeParse(0).success).toBe(true)
    expect(definition.schema.safeParse(1_000_000).success).toBe(true)
    expect(definition.schema.safeParse(1_000_001).success).toBe(false)
    expect(definition.schema.safeParse(20_000.5).success).toBe(false)
  })

  it('has no refund numbering settings, because the till numbers refunds offline', () => {
    const keys = Object.keys(SETTING_DEFINITIONS)
    expect(keys.some((key) => /refund(i?Prefix|Sequence|Number)/i.test(key))).toBe(false)
  })
})

describe.skipIf(!available)('phase 13 schema and settings', () => {
  const createdUserIds: string[] = []
  const createdBranchIds: string[] = []
  let adminCookie = ''
  let managerCookie = ''
  let branchId = ''

  beforeAll(async () => {
    const admin = await createTestUser({ role: 'ADMIN', name: 'Phase 13 Admin' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    const created = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `P13${randomToken(1)}`,
        name: 'Phase 13 Branch',
        type: 'RETAIL',
        city: 'Accra',
      }),
    })
    expect(created.status).toBe(201)
    const body = (await created.json()) as { branch: { id: string } }
    branchId = body.branch.id
    createdBranchIds.push(branchId)

    const manager = await createTestUser({
      role: 'MANAGER',
      branchId,
      name: 'Phase 13 Manager',
    })
    createdUserIds.push(manager.id)
    managerCookie = await signIn(manager.email)
  })

  afterAll(async () => {
    await db.delete(setting).where(eq(setting.key, 'pos.refundApprovalThresholdMinor'))
    for (const id of createdUserIds) await deleteTestUser(id)
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  it('resolves the refund threshold to its default and audits no write', async () => {
    const response = await app.request('/api/settings', { headers: authedHeaders(adminCookie) })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      settings: { key: string; value: unknown; source: string; writableBy: string }[]
    }
    const threshold = body.settings.find((item) => item.key === 'pos.refundApprovalThresholdMinor')
    expect(threshold?.value).toBe(20_000)
    expect(threshold?.source).toBe('default')
    expect(threshold?.writableBy).toBe('admin')
  })

  it('refuses a manager write to the refund threshold', async () => {
    const denied = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ key: 'pos.refundApprovalThresholdMinor', value: 500_000 }),
    })
    expect(denied.status).toBe(403)

    const rows = await db
      .select()
      .from(setting)
      .where(eq(setting.key, 'pos.refundApprovalThresholdMinor'))
    expect(rows).toHaveLength(0)
  })

  it('lets an admin set the threshold for one branch', async () => {
    const allowed = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        key: 'pos.refundApprovalThresholdMinor',
        value: 30_000,
        branchId,
      }),
    })
    expect(allowed.status).toBe(200)

    const scoped = await app.request(`/api/settings?branchId=${branchId}`, {
      headers: authedHeaders(adminCookie),
    })
    const body = (await scoped.json()) as {
      settings: { key: string; value: unknown; source: string }[]
    }
    const threshold = body.settings.find((item) => item.key === 'pos.refundApprovalThresholdMinor')
    expect(threshold?.value).toBe(30_000)
    expect(threshold?.source).toBe('branch')
  })

  it('creates the payment, refund, void and shift-report tables with the columns they need', async () => {
    const result = await db.execute<ColumnRow>(
      sql`select table_name, column_name from information_schema.columns where table_schema = 'public'`,
    )
    const columns = new Set(result.rows.map((row) => `${row.table_name}.${row.column_name}`))

    const expected: Record<string, readonly string[]> = {
      payment: [
        'branch_id',
        'terminal_id',
        'device_id',
        'shift_id',
        'client_payment_id',
        'method',
        'amount_minor',
        'provider',
        'provider_reference',
        'provider_email',
        'provider_transaction_id',
        'status',
        'orphaned',
        'last_verified_at',
        'expires_at',
        'paid_at',
      ],
      payment_event: ['provider', 'event_type', 'body_sha256', 'payment_id', 'status', 'detail'],
      sale_tender: ['sequence', 'payment_id', 'reference'],
      refund: [
        'number',
        'sale_id',
        'shift_id',
        'reason_code',
        'refunded_minor',
        'base_minor',
        'tax_total_minor',
        'approved_by_staff_id',
        'approval_pin_version',
        'approval_id',
        'occurred_at',
      ],
      refund_line: ['refund_id', 'sale_line_id', 'restock', 'damage_reason', 'total_minor'],
      refund_tender: [
        'refund_id',
        'sequence',
        'method',
        'amount_minor',
        'sale_tender_id',
        'payment_id',
        'provider_refund_reference',
        'status',
      ],
      cart_void: ['reason_code', 'note', 'item_count', 'gross_minor', 'label', 'lines'],
      shift_report: [
        'shift_id',
        'number',
        'sale_count',
        'void_count',
        'refund_count',
        'gross_minor',
        'net_minor',
        'momo_minor',
        'card_minor',
        'bank_transfer_minor',
        'variance_minor',
      ],
    }

    for (const [table, names] of Object.entries(expected)) {
      for (const name of names) {
        expect(columns.has(`${table}.${name}`), `${table}.${name} is missing`).toBe(true)
      }
    }

    // No card data is ever stored (P13-D15).
    for (const name of ['bin', 'last4', 'card_authorization']) {
      expect(columns.has(`payment.${name}`), `payment.${name} must not exist`).toBe(false)
    }
  })

  it('adds the phase 13 enum values and creates the new enums', async () => {
    const result = await db.execute<EnumRow>(
      sql`select t.typname as type_name, e.enumlabel as value
          from pg_type t
          join pg_enum e on e.enumtypid = t.oid
          join pg_namespace n on n.oid = t.typnamespace
          where n.nspname = 'public'`,
    )
    const values = new Set(result.rows.map((row) => `${row.type_name}.${row.value}`))

    const expected: Record<string, readonly string[]> = {
      sale_tender_method: ['CASH', 'CREDIT', 'MOMO', 'CARD', 'BANK_TRANSFER'],
      pos_transaction_type: ['REFUND', 'CREDIT_REPAYMENT', 'CART_VOID'],
      stock_movement_type: ['RETURN'],
      stock_movement_reference: ['REFUND'],
      sync_conflict_type: ['PAYMENT_LATE_SETTLEMENT', 'PAYMENT_AMOUNT_MISMATCH'],
      payment_method: ['MOMO', 'CARD', 'BANK_TRANSFER'],
      payment_provider: ['PAYSTACK', 'MOCK'],
      payment_status: ['PENDING', 'PAID', 'FAILED', 'ABANDONED', 'EXPIRED'],
      refund_reason: ['DEFECTIVE', 'DUPLICATE_SALE'],
      refund_restock: ['RESALABLE', 'DAMAGED', 'NOT_RETURNED'],
      refund_tender_status: ['SETTLED', 'PENDING', 'FAILED', 'NEEDS_ATTENTION'],
      cart_void_reason: ['CUSTOMER_CHANGED_MIND', 'DUPLICATE_SCAN', 'CUSTOMER_LEFT', 'OTHER'],
    }

    for (const [type, names] of Object.entries(expected)) {
      for (const name of names) {
        expect(values.has(`${type}.${name}`), `${type}.${name} is missing`).toBe(true)
      }
    }
  })

  it('keeps sync_conflict_type and SyncConflictType the same set, in the same order', async () => {
    const result = await db.execute<EnumRow>(
      sql`select t.typname as type_name, e.enumlabel as value
          from pg_type t
          join pg_enum e on e.enumtypid = t.oid
          join pg_namespace n on n.oid = t.typnamespace
          where n.nspname = 'public' and t.typname = 'sync_conflict_type'
          order by e.enumsortorder`,
    )
    const dbValues = result.rows.map((row) => row.value)

    expect(dbValues).toEqual([...syncConflictTypeEnum.enumValues])

    // Compile-time half of the same assertion: if either list gains a value the
    // other lacks, `check-types` fails on the line below.
    type EnumValue = (typeof syncConflictTypeEnum.enumValues)[number]
    const sameSet: [EnumValue] extends [SyncConflictType]
      ? [SyncConflictType] extends [EnumValue]
        ? true
        : false
      : false = true
    expect(sameSet).toBe(true)
  })

  it('replaces the sale-tender method key with an ordered key and a partial payment key', async () => {
    const result = await db.execute<IndexRow>(
      sql`select indexname, indexdef from pg_indexes where schemaname = 'public'`,
    )
    const indexes = new Map(result.rows.map((row) => [row.indexname, row.indexdef]))

    expect(indexes.has('sale_tender_sale_method_unique')).toBe(false)

    const sequence = indexes.get('sale_tender_sale_sequence_unique')
    expect(sequence).toBeDefined()
    expect(sequence).toContain('UNIQUE INDEX')
    expect(sequence).toContain('sale_id')
    expect(sequence).toContain('sequence')

    const payment = indexes.get('sale_tender_payment_unique')
    expect(payment).toBeDefined()
    expect(payment).toContain('UNIQUE INDEX')
    expect(payment).toContain('WHERE')
    expect(payment).toContain('payment_id IS NOT NULL')

    const report = indexes.get('shift_report_shift_unique')
    expect(report).toBeDefined()
    expect(report).toContain('UNIQUE INDEX')

    for (const name of [
      'payment_shift_idx',
      'payment_status_created_idx',
      'refund_number_unique',
    ]) {
      expect(indexes.has(name), `${name} is missing`).toBe(true)
    }
  })

  it('gives payment.shift_id no foreign key so the module dependency stays one-way', async () => {
    const result = await db.execute<ForeignKeyRow>(
      sql`select tc.table_name, kcu.column_name
          from information_schema.table_constraints tc
          join information_schema.key_column_usage kcu
            on kcu.constraint_name = tc.constraint_name
           and kcu.table_schema = tc.table_schema
          where tc.constraint_type = 'FOREIGN KEY'
            and tc.table_schema = 'public'
            and tc.table_name in ('payment', 'sale_tender')`,
    )
    const keys = new Set(result.rows.map((row) => `${row.table_name}.${row.column_name}`))

    expect(keys.has('payment.shift_id')).toBe(false)
    expect(keys.has('sale_tender.payment_id')).toBe(true)
  })
})
