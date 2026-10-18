import { sql } from 'drizzle-orm'
import { index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { branch } from '../org/branches.schema.ts'

export const customerStatusEnum = pgEnum('customer_status', ['ACTIVE', 'ARCHIVED'])

/**
 * Global customer identity: created at a branch, found everywhere.
 * Phone is unique among non-anonymized customers; anonymization (Ghana DPA)
 * scrubs PII and releases the phone for reuse.
 */
export const customer = pgTable(
  'customer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    phone: text('phone'),
    email: text('email'),
    address: text('address'),
    createdBranchId: uuid('created_branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    status: customerStatusEnum('status').notNull().default('ACTIVE'),
    anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('customer_phone_unique').on(table.phone).where(sql`${table.anonymizedAt} is null`),
    index('customer_branch_idx').on(table.createdBranchId),
    index('customer_status_idx').on(table.status),
  ],
)
