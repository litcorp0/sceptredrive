import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
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

/** What a schedule counts: a category, a brand, an ABC class, or a rotation slice. */
export const countScopeEnum = pgEnum('count_scope', ['CATEGORY', 'BRAND', 'ABC_CLASS', 'ROTATION'])

export const countFrequencyEnum = pgEnum('count_frequency', [
  'WEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'BIANNUAL',
])

export const countTypeEnum = pgEnum('count_type', ['MANUAL', 'SCHEDULED', 'TRIGGER'])

export const countTriggerReasonEnum = pgEnum('count_trigger_reason', ['VARIANCE', 'OVERSELL'])

export const abcClassEnum = pgEnum('abc_class', ['A', 'B', 'C'])

/**
 * A recurring count scope (Phase 12, CC-01). One text `scope_key` instead of four
 * nullable foreign keys: the unique index is trivial, the resolver is one switch,
 * and a schedule cannot be half-configured (a CATEGORY scope with a brand id) —
 * P12-D28.
 */
export const countSchedule = pgTable(
  'count_schedule',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    scope: countScopeEnum('scope').notNull(),
    /** `category:<uuid>`, `brand:<uuid>`, `ABC:A`, `ROTATION`. */
    scopeKey: text('scope_key').notNull(),
    frequency: countFrequencyEnum('frequency').notNull(),
    nextDueAt: date('next_due_at').notNull(),
    assignedTo: text('assigned_to'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('count_schedule_branch_scope_unique').on(table.branchId, table.scopeKey),
    index('count_schedule_active_due_idx').on(table.isActive, table.nextDueAt),
  ],
)

/**
 * ABC class per product per branch (Phase 12, CC-05). Derived nightly from
 * `value_minor + sold_minor`, and manually overridable: the job skips
 * `is_manual = true` rows (P12-D29).
 */
export const stockAbcClass = pgTable(
  'stock_abc_class',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    class: abcClassEnum('class').notNull(),
    /** On-hand × average cost: stock at risk. */
    valueMinor: integer('value_minor').notNull().default(0),
    /** 90-day ex-tax base: what moves. */
    soldMinor: integer('sold_minor').notNull().default(0),
    /** `value_minor + sold_minor`, the ranking input. */
    score: integer('score').notNull().default(0),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
    isManual: boolean('is_manual').notNull().default(false),
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('stock_abc_class_product_branch_unique').on(table.productId, table.branchId),
    index('stock_abc_class_branch_class_idx').on(table.branchId, table.class),
  ],
)

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
    countType: countTypeEnum('count_type').notNull().default('MANUAL'),
    /** Null for a manual count raised without a scope. */
    scope: countScopeEnum('scope'),
    scopeKey: text('scope_key'),
    dueAt: date('due_at'),
    assignedTo: text('assigned_to'),
    scheduleId: uuid('schedule_id').references(() => countSchedule.id, { onDelete: 'set null' }),
    triggerReason: countTriggerReasonEnum('trigger_reason'),
    triggerProductId: uuid('trigger_product_id').references(() => product.id, {
      onDelete: 'restrict',
    }),
    /** The count or sync conflict that raised this trigger count. */
    triggerSourceId: uuid('trigger_source_id'),
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
    // De-duplication is an index, not a query: one open trigger count per product
    // per branch, and one open count per schedule (P12-D30).
    uniqueIndex('stock_count_open_trigger_unique')
      .on(table.branchId, table.triggerProductId)
      .where(sql`${table.status} = 'OPEN' and ${table.triggerProductId} is not null`),
    uniqueIndex('stock_count_open_schedule_unique')
      .on(table.scheduleId)
      .where(sql`${table.status} = 'OPEN' and ${table.scheduleId} is not null`),
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
