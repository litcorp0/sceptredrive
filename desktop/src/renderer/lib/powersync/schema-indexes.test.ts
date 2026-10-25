import { describe, expect, it } from 'vitest'
import { PosSchema } from './schema'
import { PreviousPosSchema } from './schema-migration'

/**
 * The `sale` indexes the home screen depends on (P10-D12).
 *
 * The migration proof runs in Electron against real SQLite; this is the fast
 * gate that fails in a millisecond if a future edit drops or reorders an index
 * and nobody re-runs the browser proof.
 */

function saleIndexes(
  tables: { name: string; indexes: { name: string; columns: { name: string }[] }[] }[],
) {
  const sale = tables.find((table) => table.name === 'sale')
  if (!sale) throw new Error('the schema has no `sale` table')

  const indexes: Record<string, string[]> = {}
  for (const index of sale.indexes) {
    indexes[index.name] = index.columns.map((column) => column.name)
  }
  return indexes
}

describe('the sale table', () => {
  it('declares the terminal-and-day index with terminal_id first', () => {
    const indexes = saleIndexes(PosSchema.tables)

    expect(indexes.sale_terminal_occurred).toEqual(['terminal_id', 'occurred_at'])
    // Column order is the whole point: a terminal filter that is not the leading
    // column cannot use this index for the home screen's day window.
    expect(indexes.sale_terminal_occurred?.[0]).toBe('terminal_id')
  })

  it('keeps the shift-close and sales-screen indexes', () => {
    expect(saleIndexes(PosSchema.tables)).toMatchObject({
      sale_shift: ['shift_id'],
      sale_occurred: ['occurred_at'],
    })
  })

  it('declares exactly those three indexes', () => {
    expect(Object.keys(saleIndexes(PosSchema.tables)).sort()).toEqual([
      'sale_occurred',
      'sale_shift',
      'sale_terminal_occurred',
    ])
  })
})

describe('the frozen previous schema', () => {
  it('has the same sale columns as the current schema', () => {
    const current = PosSchema.tables.find((table) => table.name === 'sale')
    const previous = PreviousPosSchema.tables.find((table) => table.name === 'sale')

    expect(previous?.columns.map((column) => column.name).sort()).toEqual(
      current?.columns.map((column) => column.name).sort(),
    )
  })

  it('does not have the index under proof', () => {
    // If this ever fails, the migration case would be migrating a database that
    // already has `sale_terminal_occurred` — which proves nothing (P10-D15).
    expect(saleIndexes(PreviousPosSchema.tables)).not.toHaveProperty('sale_terminal_occurred')
    expect(saleIndexes(PreviousPosSchema.tables)).toEqual({
      sale_shift: ['shift_id'],
      sale_occurred: ['occurred_at'],
    })
  })

  it('declares every table the current schema declares', () => {
    expect(PreviousPosSchema.tables.map((table) => table.name).sort()).toEqual(
      PosSchema.tables.map((table) => table.name).sort(),
    )
  })
})
