import { db } from '@sceptre/db'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { databaseAvailable } from '../../../test/integration.ts'
import { branch } from '../org/branches.schema.ts'
import { documentSequence } from './sequences.schema.ts'
import {
  allocateDocumentNumber,
  currentDocumentPeriod,
  DOCUMENT_KINDS,
} from './sequences.service.ts'
import { setting } from './settings.schema.ts'
import { isSettingKey, SETTING_DEFINITIONS } from './settings.validation.ts'

const available = await databaseAvailable()
if (!available) console.warn('[sequences.test] database unavailable; integration tests skipped')

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()

let branchAId: string
let branchBId: string
const branchIds: string[] = []

beforeAll(async () => {
  if (!available) return
  const rows = await db
    .insert(branch)
    .values([
      { code: `QA${suffix.slice(0, 4)}`, name: `Sequence A ${suffix}`, city: 'Accra' },
      { code: `QB${suffix.slice(0, 4)}`, name: `Sequence B ${suffix}`, city: 'Kumasi' },
    ])
    .returning({ id: branch.id, code: branch.code })

  branchAId = rows[0]?.id ?? ''
  branchBId = rows[1]?.id ?? ''
  branchIds.push(branchAId, branchBId)
})

afterAll(async () => {
  if (!available) return
  await db.delete(documentSequence).where(eq(documentSequence.branchId, branchAId))
  await db.delete(documentSequence).where(eq(documentSequence.branchId, branchBId))
  for (const id of branchIds) {
    await db.delete(branch).where(eq(branch.id, id))
  }
})

describe.skipIf(!available)('document numbering', () => {
  it('formats PO-<branch>-<YYYYMM>-<serial>', async () => {
    const period = currentDocumentPeriod()
    const { number, sequenceValue } = await allocateDocumentNumber('purchase_order', branchAId, db)

    expect(sequenceValue).toBe(1)
    expect(number).toMatch(/^PO-[A-Z0-9]+-\d{6}-0001$/)
    expect(number).toContain(period.replace('-', ''))
  })

  it('increments within a branch and month', async () => {
    const { number } = await allocateDocumentNumber('purchase_order', branchAId, db)
    expect(number.endsWith('-0002')).toBe(true)
  })

  it('starts each branch at one', async () => {
    const { number } = await allocateDocumentNumber('purchase_order', branchBId, db)
    expect(number.endsWith('-0001')).toBe(true)
  })

  it('starts each month at one', async () => {
    const nextMonth = new Date()
    nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1)

    const { number, sequenceValue } = await allocateDocumentNumber(
      'purchase_order',
      branchAId,
      db,
      nextMonth,
    )
    expect(sequenceValue).toBe(1)
    expect(number.endsWith('-0001')).toBe(true)
  })

  it('keeps kinds apart', async () => {
    const { number } = await allocateDocumentNumber('supplier_return', branchAId, db)
    expect(number).toMatch(/^PR-[A-Z0-9]+-\d{6}-0001$/)
  })

  it('never issues the same number twice under concurrency', async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        allocateDocumentNumber('supplier_credit_note', branchAId, db),
      ),
    )
    const numbers = results.map((result) => result.number)
    expect(new Set(numbers).size).toBe(numbers.length)
  })

  it('uses the configured prefix', async () => {
    const key = 'procurement.orderPrefix'
    const previous = await db.select().from(setting).where(eq(setting.key, key)).limit(1)
    await db.insert(setting).values({ key, value: 'BUY', branchId: null }).onConflictDoNothing()

    try {
      const { number } = await allocateDocumentNumber('purchase_order', branchBId, db)
      expect(number.startsWith('BUY-')).toBe(true)
    } finally {
      if (previous[0]) {
        await db
          .update(setting)
          .set({ value: previous[0].value })
          .where(eq(setting.id, previous[0].id))
      } else {
        await db.delete(setting).where(eq(setting.key, key))
      }
    }
  })

  it('declares a prefix setting for every kind', () => {
    for (const [kind, format] of Object.entries(DOCUMENT_KINDS)) {
      // Phase 12 added `stock_write_off`, whose prefix is `inventory.*`; the
      // contract is a real setting key, not a procurement-only namespace.
      expect(isSettingKey(format.prefixKey)).toBe(true)
      expect(SETTING_DEFINITIONS[format.prefixKey].schema.safeParse('XX').success).toBe(true)
      expect(format.pad).toBeGreaterThan(0)
      expect(kind.length).toBeGreaterThan(0)
    }
  })
})
