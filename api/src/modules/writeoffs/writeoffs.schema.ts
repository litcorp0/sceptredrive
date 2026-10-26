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
import { approval } from '../approvals/approvals.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { product } from '../products/products.schema.ts'

/**
 * A shrinkage document (Phase 12, BRN-02). It is raised complete and decided as
 * one unit: there is no DRAFT, because a half-written shrinkage report is a
 * number nobody can approve.
 *
 * `APPROVED` means **posted** — the decision handler writes the `WRITE_OFF`
 * movements in the same transaction and stamps `posted_at`. A separate POSTED
 * state could drift out of sync with the ledger, so it does not exist (P12-D14).
 *
 * The reference to the approval is a real foreign key because the approval is
 * created first and the document points at it; the reverse link is the approval's
 * plain `entity_id`, which keeps the dependency one way (`writeoffs → approvals`).
 */
export const stockWriteOffStatusEnum = pgEnum('stock_write_off_status', [
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
])

/** Why a line is being written off. Per line, because a pallet can be half damaged and half stolen. */
export const stockWriteOffReasonEnum = pgEnum('stock_write_off_reason', [
  'DAMAGE',
  'EXPIRY',
  'OBSOLESCENCE',
  'THEFT',
  'SUPPLIER_FAULT',
  'OTHER',
])

export const stockWriteOff = pgTable(
  'stock_write_off',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    status: stockWriteOffStatusEnum('status').notNull().default('PENDING_APPROVAL'),
    note: text('note'),
    /** Σ line quantity × the stored line cost, frozen when the request was raised (P12-D17). */
    valueMinor: integer('value_minor').notNull().default(0),
    approvalId: uuid('approval_id').references(() => approval.id, { onDelete: 'restrict' }),
    requestedBy: text('requested_by').notNull(),
    /** Set by the decision handler in the same transaction that posts the movements. */
    postedAt: timestamp('posted_at', { withTimezone: true }),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    cancelledBy: text('cancelled_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('stock_write_off_number_unique').on(table.number),
    index('stock_write_off_branch_status_created_idx').on(
      table.branchId,
      table.status,
      table.createdAt,
    ),
    index('stock_write_off_approval_idx').on(table.approvalId),
  ],
)

export const stockWriteOffLine = pgTable(
  'stock_write_off_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    writeOffId: uuid('write_off_id')
      .notNull()
      .references(() => stockWriteOff.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    /**
     * The branch's average cost when the request was raised. The posted movement
     * carries this stored value, so the ledger equals the approved value to the
     * pesewa even if a receipt moves the average before the decision (P12-D17).
     */
    unitCostMinor: integer('unit_cost_minor').notNull(),
    reason: stockWriteOffReasonEnum('reason').notNull(),
    /** Required for THEFT and OTHER; validated in the request schema. */
    note: text('note'),
  },
  (table) => [
    uniqueIndex('stock_write_off_line_write_off_product_unique').on(
      table.writeOffId,
      table.productId,
    ),
    index('stock_write_off_line_product_idx').on(table.productId),
  ],
)
