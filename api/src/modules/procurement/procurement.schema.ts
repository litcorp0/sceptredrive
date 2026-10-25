import {
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
import { approval } from '../approvals/approvals.schema.ts'
import { stockReceipt, stockReceiptLine } from '../inventory/inventory.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { product } from '../products/products.schema.ts'
import { supplier } from '../suppliers/suppliers.schema.ts'

/**
 * Procurement documents: purchase orders, their lines, supplier returns, and
 * the credit notes a return creates.
 *
 * Money lives on the lines only. A purchase order has **no total column** — the
 * goods value is `Σ quantity × unit_cost_minor`, computed where it is needed
 * (the threshold check, the list, the print sheet). A stored total is a second
 * truth that drifts on every draft edit, and the approval threshold is exactly
 * the number that must not drift.
 *
 * `stock_receipt.purchase_order_id` and `stock_receipt_line.purchase_order_line_id`
 * are plain uuids rather than foreign keys into this file: the inventory module
 * must not import procurement (procurement imports inventory for the return
 * lines, and a cycle between schema modules is a load-order bug waiting to
 * happen). The relationship is owned here, indexed there, and checked in the
 * service — the same deliberate soft-reference pattern as `setting.branch_id`.
 */

export const purchaseOrderStatusEnum = pgEnum('purchase_order_status', [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'REJECTED',
  'SENT',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CLOSED',
  'CANCELLED',
])

export const supplierReturnStatusEnum = pgEnum('supplier_return_status', [
  'DRAFT',
  'POSTED',
  'CANCELLED',
])

export const purchaseOrder = pgTable(
  'purchase_order',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => supplier.id, { onDelete: 'restrict' }),
    status: purchaseOrderStatusEnum('status').notNull().default('DRAFT'),
    expectedDate: date('expected_date'),
    note: text('note'),
    requestedBy: text('requested_by').notNull(),
    /** Null for an auto-approved order: there was no human decision to record. */
    approvalId: uuid('approval_id').references(() => approval.id, { onDelete: 'restrict' }),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectedAt: timestamp('rejected_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    sentBy: text('sent_by'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: text('closed_by'),
    closeNote: text('close_note'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: text('cancelled_by'),
    cancelReason: text('cancel_reason'),
    idempotencyKey: text('idempotency_key'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('purchase_order_number_unique').on(table.number),
    uniqueIndex('purchase_order_idempotency_unique').on(table.branchId, table.idempotencyKey),
    index('purchase_order_branch_status_created_idx').on(
      table.branchId,
      table.status,
      table.createdAt,
    ),
    index('purchase_order_supplier_status_idx').on(table.supplierId, table.status),
    index('purchase_order_expected_date_idx').on(table.expectedDate),
  ],
)

export const purchaseOrderLine = pgTable(
  'purchase_order_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => purchaseOrder.id, { onDelete: 'cascade' }),
    lineNumber: integer('line_number').notNull(),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    unitCostMinor: integer('unit_cost_minor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('purchase_order_line_number_unique').on(table.orderId, table.lineNumber),
    uniqueIndex('purchase_order_line_product_unique').on(table.orderId, table.productId),
    index('purchase_order_line_product_idx').on(table.productId),
  ],
)

/**
 * A return of goods to a supplier. A draft posts nothing; posting writes the
 * negative stock movement and its credit note in one transaction.
 */
export const supplierReturn = pgTable(
  'supplier_return',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => supplier.id, { onDelete: 'restrict' }),
    purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrder.id, {
      onDelete: 'restrict',
    }),
    receiptId: uuid('receipt_id').references(() => stockReceipt.id, { onDelete: 'restrict' }),
    status: supplierReturnStatusEnum('status').notNull().default('DRAFT'),
    reason: text('reason').notNull(),
    note: text('note'),
    /** Our credit-note number, allocated when the return posts. */
    creditNoteNumber: text('credit_note_number'),
    /** The supplier's own reference, recorded when they give one. */
    supplierCreditNoteNumber: text('supplier_credit_note_number'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    postedBy: text('posted_by'),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelledBy: text('cancelled_by'),
    cancelReason: text('cancel_reason'),
    idempotencyKey: text('idempotency_key'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('supplier_return_number_unique').on(table.number),
    uniqueIndex('supplier_return_idempotency_unique').on(table.branchId, table.idempotencyKey),
    index('supplier_return_branch_status_created_idx').on(
      table.branchId,
      table.status,
      table.createdAt,
    ),
    index('supplier_return_supplier_created_idx').on(table.supplierId, table.createdAt),
  ],
)

export const supplierReturnLine = pgTable(
  'supplier_return_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    returnId: uuid('return_id')
      .notNull()
      .references(() => supplierReturn.id, { onDelete: 'cascade' }),
    receiptLineId: uuid('receipt_line_id')
      .notNull()
      .references(() => stockReceiptLine.id, { onDelete: 'restrict' }),
    purchaseOrderLineId: uuid('purchase_order_line_id').references(() => purchaseOrderLine.id, {
      onDelete: 'restrict',
    }),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    /** The cost the branch actually paid, copied from the receipt line. */
    unitCostMinor: integer('unit_cost_minor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('supplier_return_line_receipt_line_unique').on(table.returnId, table.receiptLineId),
    index('supplier_return_line_receipt_line_idx').on(table.receiptLineId),
    index('supplier_return_line_product_idx').on(table.productId),
  ],
)

/**
 * The credit note a posted return creates: 1:1 with the return, reducing what
 * the branch owes. It is a ledger fact, never edited; a mistake is corrected by
 * a compensating document.
 */
export const supplierCreditNote = pgTable(
  'supplier_credit_note',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => supplier.id, { onDelete: 'restrict' }),
    returnId: uuid('return_id')
      .notNull()
      .references(() => supplierReturn.id, { onDelete: 'restrict' }),
    amountMinor: integer('amount_minor').notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('supplier_credit_note_number_unique').on(table.number),
    uniqueIndex('supplier_credit_note_return_unique').on(table.returnId),
    index('supplier_credit_note_branch_posted_idx').on(table.branchId, table.postedAt),
    index('supplier_credit_note_supplier_idx').on(table.supplierId),
  ],
)
