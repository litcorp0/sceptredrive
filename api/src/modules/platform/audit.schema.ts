import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

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
