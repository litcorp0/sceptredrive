import type { Transaction } from '@powersync/web'
import { describe, expect, it } from 'vitest'
import { nextValue } from '../document-sequence'
import { allocateReceiptNumber, formatReceiptNumber, peekReceiptNumber } from './document-sequence'

/**
 * Receipt numbering must be readable, terminal-scoped, and safe across days and
 * restarts. The number is allocated inside the sale transaction; these tests
 * prove the pure formatting, the peek (which writes nothing), and the
 * allocate path (which consumes exactly one value).
 */

describe('formatReceiptNumber', () => {
  it('is terminal-scoped, dated, and zero-padded', () => {
    expect(formatReceiptNumber('SPX-T01', '20261023', 7)).toBe('SPX-T01-20261023-0007')
    expect(formatReceiptNumber('SPX-T01', '20261023', 1234)).toBe('SPX-T01-20261023-1234')
  })
})

describe('nextValue', () => {
  it('starts at 1 and tolerates a missing or corrupt row', () => {
    expect(nextValue(undefined)).toBe(1)
    expect(nextValue(null)).toBe(1)
    expect(nextValue(6)).toBe(7)
    expect(nextValue(Number.NaN)).toBe(1)
    expect(nextValue(-3)).toBe(1)
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
    }

    const number = await peekReceiptNumber(
      db as unknown as Parameters<typeof peekReceiptNumber>[0],
      'terminal-1',
      'SPX-T01',
      new Date('2026-10-23T10:00:00Z'),
    )
    expect(number).toBe('SPX-T01-20261023-0007')
    expect(statements).toHaveLength(0)
  })

  it('starts at 0001 when nothing was sold today', async () => {
    const db = { getOptional: async () => null }
    const number = await peekReceiptNumber(
      db as unknown as Parameters<typeof peekReceiptNumber>[0],
      'terminal-1',
      'ACC-T02',
      new Date('2026-10-23T23:30:00Z'),
    )
    expect(number).toBe('ACC-T02-20261023-0001')
  })
})

describe('allocateReceiptNumber', () => {
  it('consumes the number for the Accra day and writes the sequence', async () => {
    const writes: Array<{ sql: string; parameters: unknown[] | undefined }> = []
    const tx = {
      getOptional: async () => ({ last_value: 41 }),
      execute: async (sql: string, parameters?: unknown[]) => {
        writes.push({ sql, parameters })
      },
    } as unknown as Transaction

    const number = await allocateReceiptNumber(
      tx,
      'terminal-1',
      'ACC-SPX-T01',
      new Date('2026-10-23T10:00:00Z'),
    )

    expect(number).toBe('ACC-SPX-T01-20261023-0042')
    expect(writes).toHaveLength(1)
    expect(writes[0]?.parameters?.[0]).toBe('terminal-1:sale:20261023')
    expect(writes[0]?.parameters?.at(-1)).toBe(42)
  })

  it('rolls to a new day at Accra midnight (UTC)', async () => {
    let day: string | null = null
    const tx = {
      getOptional: async (_sql: string, parameters?: unknown[]) => {
        day = String(parameters?.[2])
        return day === '20261023' ? { last_value: 99 } : null
      },
      execute: async () => {},
    } as unknown as Transaction

    const late = await allocateReceiptNumber(
      tx,
      'terminal-1',
      'ACC-SPX-T01',
      new Date('2026-10-23T23:59:59Z'),
    )
    const nextDay = await allocateReceiptNumber(
      tx,
      'terminal-1',
      'ACC-SPX-T01',
      new Date('2026-10-24T00:00:01Z'),
    )

    expect(late).toBe('ACC-SPX-T01-20261023-0100')
    expect(nextDay).toBe('ACC-SPX-T01-20261024-0001')
  })
})
