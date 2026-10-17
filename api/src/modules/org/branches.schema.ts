import {
  boolean,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

export const branchTypeEnum = pgEnum('branch_type', ['RETAIL', 'WAREHOUSE'])

export const branch = pgTable(
  'branch',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    type: branchTypeEnum('type').notNull().default('RETAIL'),
    city: text('city').notNull(),
    area: text('area'),
    address: text('address'),
    phone: text('phone'),
    isActive: boolean('is_active').notNull().default(true),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('branch_code_unique').on(table.code),
    index('branch_type_idx').on(table.type),
    index('branch_active_idx').on(table.isActive),
  ],
)
