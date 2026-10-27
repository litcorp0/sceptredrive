import { describe, expect, it } from 'vitest'
import { PosSchema, SYNCED_TABLES } from './schema'
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
  return tableIndexes(tables, 'sale')
}

function tableIndexes(
  tables: { name: string; indexes: { name: string; columns: { name: string }[] }[] }[],
  tableName: string,
) {
  const table = tables.find((candidate) => candidate.name === tableName)
  if (!table) throw new Error(`the schema has no \`${tableName}\` table`)

  const indexes: Record<string, string[]> = {}
  for (const index of table.indexes) {
    indexes[index.name] = index.columns.map((column) => column.name)
  }
  return indexes
}

function tableColumns(
  tables: { name: string; columns: { name: string }[] }[],
  tableName: string,
): string[] {
  const table = tables.find((candidate) => candidate.name === tableName)
  if (!table) throw new Error(`the schema has no \`${tableName}\` table`)
  return table.columns.map((column) => column.name)
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

describe('the tables Plan 08 added', () => {
  it('orders a sale’s tenders by sequence', () => {
    const indexes = tableIndexes(PosSchema.tables, 'sale_tender')

    expect(indexes.sale_tender_sale_sequence).toEqual(['sale_id', 'sequence'])
    expect(indexes.sale_tender_sale).toEqual(['sale_id'])
  })

  it('carries the split-tender columns on sale_tender', () => {
    expect(tableColumns(PosSchema.tables, 'sale_tender')).toEqual(
      expect.arrayContaining(['sequence', 'payment_id', 'provider_reference']),
    )
  })

  it('indexes every lookup the new screens make', () => {
    expect(tableIndexes(PosSchema.tables, 'cart_tender')).toMatchObject({
      cart_tender_draft: ['draft_id'],
    })
    expect(tableIndexes(PosSchema.tables, 'held_cart')).toMatchObject({
      held_cart_held_at: ['held_at'],
    })
    expect(tableIndexes(PosSchema.tables, 'held_cart_line')).toMatchObject({
      held_cart_line_hold: ['hold_id'],
    })
    expect(tableIndexes(PosSchema.tables, 'cart_void')).toMatchObject({
      cart_void_created: ['created_at'],
    })
    expect(tableIndexes(PosSchema.tables, 'refund')).toMatchObject({
      refund_sale: ['sale_id'],
    })
    expect(tableIndexes(PosSchema.tables, 'refund_line')).toMatchObject({
      refund_line_refund: ['refund_id'],
      refund_line_sale_line: ['sale_line_id'],
    })
    expect(tableIndexes(PosSchema.tables, 'refund_tender')).toMatchObject({
      refund_tender_refund: ['refund_id'],
    })
    expect(tableIndexes(PosSchema.tables, 'shift_report')).toMatchObject({
      shift_report_shift: ['shift_id'],
    })
  })

  it('keeps the synced table list at exactly eight', () => {
    // Every new table is the terminal's own; syncing one would put its writes in
    // PowerSync's CRUD queue instead of the sale transaction.
    expect(SYNCED_TABLES).toHaveLength(8)
    for (const table of [
      'cart_tender',
      'held_cart',
      'held_cart_line',
      'cart_void',
      'refund',
      'refund_line',
      'refund_tender',
      'shift_report',
    ]) {
      expect(SYNCED_TABLES as readonly string[]).not.toContain(table)
    }
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

  it('keeps the pre-split-tender sale_tender, so the columns are proven', () => {
    // If the frozen table tracked `schema.ts`, the "before" database would
    // already have the three new columns and the migration would prove nothing.
    const previous = tableColumns(PreviousPosSchema.tables, 'sale_tender')
    expect(previous.sort()).toEqual(
      ['amount_minor', 'created_at', 'method', 'reference', 'sale_id'].sort(),
    )
    expect(previous).not.toContain('sequence')
    expect(tableIndexes(PreviousPosSchema.tables, 'sale_tender')).toEqual({
      sale_tender_sale: ['sale_id'],
    })
  })
})
