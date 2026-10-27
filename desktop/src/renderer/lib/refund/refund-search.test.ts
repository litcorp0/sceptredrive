import type { PowerSyncDatabase } from '@powersync/web'
import { describe, expect, it } from 'vitest'
import { loadRefundDraft, readLocalTerminal, searchRefundableSales } from './refund-repository'
import { RefundError } from './refund-types'

/**
 * Finding a receipt to refund (Plan 10 Task 7).
 *
 * The scope is the whole point (P13-D25): the till refunds its own sales. A
 * search matches a receipt prefix or a customer phone, and a sale from another
 * terminal is refused rather than quietly refunded.
 */

const CONFIG_ROW = {
  terminal_id: 'terminal-1',
  terminal_code: 'ACC-SPX-T01',
  branch_id: 'branch-1',
}

function reader(overrides: Record<string, unknown> = {}) {
  const queries: Array<{ sql: string; parameters: unknown[] | undefined }> = []
  const db = {
    getOptional: async (sql: string, parameters?: unknown[]) => {
      queries.push({ sql, parameters })
      if (/FROM pos_config\b/.test(sql)) return CONFIG_ROW
      if (/FROM sale s\b/.test(sql)) return overrides.sale ?? null
      if (/FROM refund WHERE/.test(sql)) return { total: 0 }
      return null
    },
    getAll: async (sql: string, parameters?: unknown[]) => {
      queries.push({ sql, parameters })
      if (/FROM sale_line\b/.test(sql)) return []
      if (/FROM refund_line\b/.test(sql)) return []
      if (/FROM sale_tender\b/.test(sql)) return []
      if (/FROM refund_tender\b/.test(sql)) return []
      return []
    },
  }
  return { db: db as unknown as PowerSyncDatabase, queries }
}

describe('searchRefundableSales', () => {
  it('searches this terminal’s sales by receipt prefix', async () => {
    const { db, queries } = reader()
    db.getAll = (async (sql: string, parameters?: unknown[]) => {
      queries.push({ sql, parameters })
      return [
        {
          sale_id: 'sale-1',
          receipt_number: 'ACC-SPX-T01-20261027-0007',
          occurred_at: '2026-10-27T09:00:00.000Z',
          total_minor: 12_000,
          tender_total_minor: 15_000,
          change_minor: 3_000,
          refunded_minor: 2_000,
          customer_name: 'Ama Boateng',
        },
      ]
    }) as never

    const rows = await searchRefundableSales(db, { query: 'ACC-SPX-T01-20261027-000' })

    const search = queries.find((query) => query.sql.includes('FROM sale s'))
    expect(search?.sql).toContain('s.terminal_id = ?')
    expect(search?.sql).toContain('s.receipt_number LIKE ?')
    expect(search?.parameters?.[0]).toBe('terminal-1')
    expect(search?.parameters?.[1]).toBe('ACC-SPX-T01-20261027-000%')

    expect(rows).toEqual([
      {
        saleId: 'sale-1',
        receiptNumber: 'ACC-SPX-T01-20261027-0007',
        occurredAt: '2026-10-27T09:00:00.000Z',
        totalMinor: 12_000,
        refundedMinor: 2_000,
        refundableMinor: 10_000,
        customerName: 'Ama Boateng',
      },
    ])
  })

  it('searches by phone digits, keeping the national form usable', async () => {
    const { db, queries } = reader()

    await searchRefundableSales(db, { query: '024 123 4567' })

    const search = queries.find((query) => query.sql.includes('FROM sale s'))
    expect(search?.sql).toContain('FROM customer WHERE phone LIKE ?')
    expect(search?.parameters?.[2]).toBe('%241234567%')
    expect(search?.parameters?.[3]).toBe('%241234567%')
  })

  it('marks a fully refunded sale as such instead of hiding it', async () => {
    const { db } = reader()
    db.getAll = (async () => [
      {
        sale_id: 'sale-2',
        receipt_number: 'ACC-SPX-T01-20261027-0008',
        occurred_at: '2026-10-27T09:30:00.000Z',
        total_minor: 12_000,
        tender_total_minor: 12_000,
        change_minor: 0,
        refunded_minor: 12_000,
        customer_name: null,
      },
    ]) as never

    const [row] = await searchRefundableSales(db, { query: '0008' })
    expect(row?.refundableMinor).toBe(0)
    expect(row?.refundedMinor).toBe(12_000)
  })

  it('returns nothing for an empty search rather than the whole day', async () => {
    const { db, queries } = reader()
    const rows = await searchRefundableSales(db, { query: '   ' })
    expect(rows).toEqual([])
    expect(queries).toHaveLength(0)
  })

  it('refuses a sale recorded on another terminal', async () => {
    const { db } = reader({
      sale: {
        id: 'sale-foreign',
        receipt_number: 'TILL-02-20261027-0001',
        terminal_id: 'terminal-2',
        shift_id: 'shift-2',
        occurred_at: '2026-10-27T09:00:00.000Z',
        total_minor: 12_000,
        tender_total_minor: 12_000,
        change_minor: 0,
        tax_mode: 'INCLUSIVE',
        customer_id: null,
        customer_name: null,
      },
    })

    await expect(loadRefundDraft(db, 'sale-foreign')).rejects.toMatchObject({
      code: 'FOREIGN_SALE',
    })
  })
})

describe('readLocalTerminal', () => {
  it('reads the terminal and branch the refund is scoped to', async () => {
    const { db } = reader()
    await expect(readLocalTerminal(db)).resolves.toEqual(CONFIG_ROW)
  })

  it('is a RefundError when the terminal is not configured', async () => {
    const db = {
      getOptional: async () => null,
      getAll: async () => [],
    } as unknown as PowerSyncDatabase
    await expect(loadRefundDraft(db, 'sale-1')).rejects.toBeInstanceOf(RefundError)
  })
})
