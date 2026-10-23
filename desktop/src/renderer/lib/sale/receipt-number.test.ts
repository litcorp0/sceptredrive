import type { PowerSyncDatabase } from '@powersync/web'
import { describe, expect, it } from 'vitest'
import { formatReceiptNumber, peekReceiptNumber } from './receipt-number'

describe('formatReceiptNumber', () => {
  it('is terminal-scoped, dated, and zero-padded', () => {
    expect(formatReceiptNumber('SPX-T01', '20261023', 7)).toBe('SPX-T01-20261023-0007')
    expect(formatReceiptNumber('SPX-T01', '20261023', 1234)).toBe('SPX-T01-20261023-1234')
  })
})

describe('peekReceiptNumber', () => {
  it('predicts the next number without consuming it', async () => {
    const statements: string[] = []
    const db = {
      getOptional: async () => ({ last_value: 6 }),
      execute: async (sql: string) => {
        statements.push(sql)
      },
    } as unknown as PowerSyncDatabase

    const number = await peekReceiptNumber(
      db,
      'terminal-1',
      'SPX-T01',
      new Date('2026-10-23T10:00:00Z'),
    )
    expect(number).toBe('SPX-T01-20261023-0007')
    expect(statements).toHaveLength(0)
  })

  it('starts at 0001 when nothing was sold today', async () => {
    const db = { getOptional: async () => null } as unknown as PowerSyncDatabase
    const number = await peekReceiptNumber(
      db,
      'terminal-1',
      'ACC-T02',
      new Date('2026-10-23T23:30:00Z'),
    )
    expect(number).toBe('ACC-T02-20261023-0001')
  })
})
