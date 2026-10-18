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
import { category } from '../catalog/catalog.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { product } from '../products/products.schema.ts'

export const stockCountStatusEnum = pgEnum('stock_count_status', ['OPEN', 'POSTED', 'CANCELLED'])

export const stockCount = pgTable(
  'stock_count',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    categoryId: uuid('category_id').references(() => category.id, { onDelete: 'set null' }),
    status: stockCountStatusEnum('status').notNull().default('OPEN'),
    note: text('note'),
    createdBy: text('created_by'),
    postedBy: text('posted_by'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    cancelledBy: text('cancelled_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('stock_count_number_unique').on(table.number),
    index('stock_count_branch_idx').on(table.branchId),
    index('stock_count_status_idx').on(table.status),
  ],
)

export const stockCountLine = pgTable(
  'stock_count_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    countId: uuid('count_id')
      .notNull()
      .references(() => stockCount.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'restrict' }),
    snapshotQty: integer('snapshot_qty').notNull(),
    countedQty: integer('counted_qty'),
  },
  (table) => [
    uniqueIndex('stock_count_line_count_product_unique').on(table.countId, table.productId),
  ],
)
