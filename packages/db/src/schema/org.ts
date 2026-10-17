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

export const deviceStatusEnum = pgEnum('device_status', ['ACTIVE', 'REVOKED'])

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

export const terminal = pgTable(
  'terminal',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    code: text('code').notNull(),
    name: text('name').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('terminal_code_unique').on(table.code),
    index('terminal_branch_idx').on(table.branchId),
  ],
)

export const device = pgTable(
  'device',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    terminalId: uuid('terminal_id')
      .notNull()
      .references(() => terminal.id, { onDelete: 'restrict' }),
    fingerprint: text('fingerprint').notNull(),
    tokenHash: text('token_hash').notNull(),
    status: deviceStatusEnum('status').notNull().default('ACTIVE'),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('device_token_hash_unique').on(table.tokenHash),
    index('device_terminal_idx').on(table.terminalId),
    index('device_status_idx').on(table.status),
  ],
)

export const terminalEnrollment = pgTable(
  'terminal_enrollment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    terminalId: uuid('terminal_id')
      .notNull()
      .references(() => terminal.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('terminal_enrollment_code_hash_unique').on(table.codeHash),
    index('terminal_enrollment_terminal_idx').on(table.terminalId),
  ],
)
