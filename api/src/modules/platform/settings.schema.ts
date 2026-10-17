import { sql } from 'drizzle-orm'
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export const setting = pgTable(
  'setting',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    branchId: uuid('branch_id'),
    updatedBy: text('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('setting_global_key_unique').on(table.key).where(sql`${table.branchId} is null`),
    uniqueIndex('setting_branch_key_unique')
      .on(table.branchId, table.key)
      .where(sql`${table.branchId} is not null`),
    index('setting_branch_idx').on(table.branchId),
  ],
)
