import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { branch } from '../org/branches.schema.ts'
import { product } from '../products/products.schema.ts'

export const transferStatusEnum = pgEnum('transfer_status', [
  'DRAFT',
  'DISPATCHED',
  'RECEIVED',
  'SHORT_CLOSED',
  'CANCELLED',
])

export const transfer = pgTable(
  'transfer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    fromBranchId: uuid('from_branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    toBranchId: uuid('to_branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    status: transferStatusEnum('status').notNull().default('DRAFT'),
    note: text('note'),
    createdBy: text('created_by'),
    dispatchedBy: text('dispatched_by'),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    receivedBy: text('received_by'),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    closedBy: text('closed_by'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    cancelledBy: text('cancelled_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('transfer_number_unique').on(table.number),
    index('transfer_from_branch_idx').on(table.fromBranchId),
    index('transfer_to_branch_idx').on(table.toBranchId),
    index('transfer_status_idx').on(table.status),
  ],
)

export const transferLine = pgTable(
  'transfer_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transferId: uuid('transfer_id')
      .notNull()
      .references(() => transfer.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'restrict' }),
    quantityRequested: integer('quantity_requested').notNull(),
    quantityDispatched: integer('quantity_dispatched').notNull().default(0),
    quantityReceived: integer('quantity_received').notNull().default(0),
    unitCostMinor: integer('unit_cost_minor').notNull().default(0),
  },
  (table) => [
    uniqueIndex('transfer_line_transfer_product_unique').on(table.transferId, table.productId),
  ],
)
