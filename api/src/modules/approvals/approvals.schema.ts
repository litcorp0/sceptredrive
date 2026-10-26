import { sql } from 'drizzle-orm'
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { branch } from '../org/branches.schema.ts'

/**
 * The shared approval entity (Phase 11, used by Phase 12 and 13).
 *
 * One row is one human decision: who asked, what the request was worth, who
 * decided, why, and when. It is immutable once decided — a second decision is a
 * new request, never an edit.
 *
 * The reference to the document is a plain uuid rather than a foreign key,
 * because the entity differs per type (a purchase order exists, a product does
 * not yet). That also keeps this file free of imports from `procurement`, so the
 * dependency runs one way only.
 */

export const approvalTypeEnum = pgEnum('approval_type', [
  // Phase 11
  'PURCHASE_ORDER',
  'PRODUCT_CREATE',
  // Phase 12
  'TRANSFER_REQUEST',
  'STOCK_WRITE_OFF',
  'PRICE_CHANGE',
  'CREDIT_LIMIT_CHANGE',
  'SHIFT_VARIANCE_REVIEW',
  // Phase 13
  'REFUND',
])

export const approvalStatusEnum = pgEnum('approval_status', [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'WITHDRAWN',
])

export const approvalReasonCodeEnum = pgEnum('approval_reason_code', [
  'OVER_THRESHOLD',
  'PRICE_TOO_HIGH',
  'OUT_OF_POLICY',
  'INCOMPLETE',
  'DUPLICATE',
  'OTHER',
])

export const approval = pgTable(
  'approval',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: approvalTypeEnum('type').notNull(),
    /** The document being decided. Null for `PRODUCT_CREATE`, which has no row yet. */
    entityId: uuid('entity_id'),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    status: approvalStatusEnum('status').notNull().default('PENDING'),
    requestedBy: text('requested_by').notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
    requestNote: text('request_note'),
    /**
     * The lowest role that may decide this row, and the branch the decider must
     * belong to (`null` = any branch, which is what an admin is). Stored on the
     * row rather than derived from the type, because a transfer's authority
     * depends on its source branch (P12-D2).
     */
    deciderRole: text('decider_role').notNull().default('ADMIN'),
    deciderBranchId: uuid('decider_branch_id').references(() => branch.id, {
      onDelete: 'restrict',
    }),
    /** The value the decision is about: goods value for a PO, the price for a product. */
    amountMinor: integer('amount_minor'),
    /** The proposed document, for types that do not have a row yet. `{}` otherwise. */
    payload: jsonb('payload').notNull().default({}),
    decidedBy: text('decided_by'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decisionReasonCode: approvalReasonCodeEnum('decision_reason_code'),
    decisionNote: text('decision_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    // One open decision per document. A double-submit cannot queue two decisions.
    uniqueIndex('approval_open_entity_unique')
      .on(table.type, table.entityId)
      .where(sql`${table.status} = 'PENDING' and ${table.entityId} is not null`),
    index('approval_branch_status_requested_idx').on(
      table.branchId,
      table.status,
      table.requestedAt,
    ),
    index('approval_type_status_idx').on(table.type, table.status),
    index('approval_decider_idx').on(table.deciderRole, table.deciderBranchId, table.status),
  ],
)
