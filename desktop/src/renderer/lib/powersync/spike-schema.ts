import { column, Schema, Table } from '@powersync/web'

/**
 * Spike schema.
 *
 * One table shaped like a synced table (PowerSync supplies the `id`) and one
 * `localOnly` table, which is the write path the POS uses for sales, the outbox,
 * and pending deltas: local-only writes never enter the upload queue.
 */
export const product = new Table(
  {
    name: column.text,
    sku: column.text,
    price_minor: column.integer,
    updated_at: column.text,
  },
  { indexes: { sku: ['sku'] } },
)

export const spikeNote = new Table(
  {
    body: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  { localOnly: true },
)

export const SpikeSchema = new Schema({
  product,
  spike_note: spikeNote,
})

export type SpikeDatabase = (typeof SpikeSchema)['types']
