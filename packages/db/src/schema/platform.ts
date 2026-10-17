import { sql } from 'drizzle-orm'
import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    actorId: text('actor_id'),
    actorStaffId: text('actor_staff_id'),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    entityId: text('entity_id'),
    before: jsonb('before'),
    after: jsonb('after'),
    branchId: uuid('branch_id'),
    terminalId: uuid('terminal_id'),
    ip: text('ip'),
    userAgent: text('user_agent'),
    requestId: text('request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('audit_entity_idx').on(table.entity, table.entityId),
    index('audit_branch_created_idx').on(table.branchId, table.createdAt),
    index('audit_actor_idx').on(table.actorId, table.createdAt),
  ],
)

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
