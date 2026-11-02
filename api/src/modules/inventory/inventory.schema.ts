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
import { branch } from '../org/branches.schema.ts'
import { product } from '../products/products.schema.ts'
import { supplier } from '../suppliers/suppliers.schema.ts'

export const stockMovementTypeEnum = pgEnum('stock_movement_type', [
  'RECEIPT',
  'ADJUSTMENT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'COUNT_VARIANCE',
  'SALE',
  // Phase 11: goods sent back to a supplier. Added by its own migration; a
  // value added inside a transaction cannot be used until that transaction
  // commits, so it never travels with the tables that write it.
  'SUPPLIER_RETURN',
  // Phase 12: a posted stock write-off (P12-D15). Same rule: its own migration.
  'WRITE_OFF',
  // Phase 13: a resalable refund line returned the goods to sellable stock
  // (P13-D22). Same rule: added by the enum-only migration.
  'RETURN',
  // Phase 19: stock the business already owned, counted at go-live. Its own
  // type so reports can tell an opening from a receipt or a correction.
  'OPENING',
])

export const stockMovementReferenceEnum = pgEnum('stock_movement_reference', [
  'RECEIPT',
  'ADJUSTMENT',
  'TRANSFER',
  'COUNT',
  'SALE',
  'SUPPLIER_RETURN',
  'WRITE_OFF',
  // Phase 13: the document a resalable refund's movement points at.
  'REFUND',
  // Phase 19: the opening document a go-live movement points at.
  'OPENING',
])

/** Why a delivery arrived with more than was ordered (Phase 11, PROC-03). */
export const overReceiptReasonEnum = pgEnum('over_receipt_reason', [
  'SUPPLIER_SENT_MORE',
  'ORDER_ROUNDING',
  'SUBSTITUTE',
  'OTHER',
])

export const stockAdjustmentReasonEnum = pgEnum('stock_adjustment_reason', [
  'DAMAGE',
  'LOSS',
  'FOUND',
  'CORRECTION',
  'EXPIRED',
  'OTHER',
  // Phase 12: the write-off reasons that share the ledger's vocabulary. EXPIRY
  // maps to EXPIRED when a write-off is posted (P12-D15, P12-D16).
  'THEFT',
  'OBSOLESCENCE',
  'SUPPLIER_FAULT',
])

/**
 * Append-only stock ledger. There are deliberately no update or delete paths
 * for this table: corrections are compensating movements.
 */
export const stockMovement = pgTable(
  'stock_movement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    type: stockMovementTypeEnum('type').notNull(),
    quantityDelta: integer('quantity_delta').notNull(),
    unitCostMinor: integer('unit_cost_minor').notNull(),
    referenceType: stockMovementReferenceEnum('reference_type').notNull(),
    referenceId: uuid('reference_id'),
    referenceNumber: text('reference_number'),
    reasonCode: stockAdjustmentReasonEnum('reason_code'),
    note: text('note'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('stock_movement_product_branch_idx').on(table.productId, table.branchId, table.createdAt),
    index('stock_movement_branch_idx').on(table.branchId, table.createdAt),
    index('stock_movement_reference_idx').on(table.referenceType, table.referenceId),
    index('stock_movement_type_idx').on(table.type, table.createdAt),
  ],
)

/** Disposable projection of the ledger: on_hand is always SUM(quantity_delta). */
export const stockLevel = pgTable(
  'stock_level',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    quantityOnHand: integer('quantity_on_hand').notNull().default(0),
    avgCostMinor: integer('avg_cost_minor').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('stock_level_product_branch_unique').on(table.productId, table.branchId),
    index('stock_level_branch_idx').on(table.branchId),
  ],
)

export const stockThreshold = pgTable(
  'stock_threshold',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    threshold: integer('threshold').notNull(),
    /** Top-up level (P11-D3); null means "no maximum set". */
    maxQuantity: integer('max_quantity'),
    /** A supplier's minimum order quantity: a floor on the suggestion. */
    minOrderQuantity: integer('min_order_quantity').notNull().default(0),
    updatedBy: text('updated_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('stock_threshold_product_branch_unique').on(table.productId, table.branchId),
    index('stock_threshold_branch_idx').on(table.branchId),
  ],
)

/** Immutable goods receipt document (supplier reference; payable arrives in Phase 5). */
export const stockReceipt = pgTable(
  'stock_receipt',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    /** Linked supplier master row; `supplierName` stays as the human-readable snapshot. */
    supplierId: uuid('supplier_id').references(() => supplier.id, { onDelete: 'restrict' }),
    supplierName: text('supplier_name'),
    supplierInvoiceNumber: text('supplier_invoice_number'),
    /**
     * The purchase order this delivery fulfils (Phase 11). A plain uuid, not a
     * foreign key: inventory must not import procurement, so the relationship is
     * owned by the procurement service and indexed here.
     */
    purchaseOrderId: uuid('purchase_order_id'),
    /** Replay guard for a console retry (P11-D20). */
    idempotencyKey: text('idempotency_key'),
    note: text('note'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('stock_receipt_number_unique').on(table.number),
    uniqueIndex('stock_receipt_idempotency_unique').on(table.branchId, table.idempotencyKey),
    index('stock_receipt_branch_idx').on(table.branchId, table.createdAt),
    index('stock_receipt_supplier_idx').on(table.supplierId),
    index('stock_receipt_purchase_order_idx').on(table.purchaseOrderId),
  ],
)

export const stockReceiptLine = pgTable(
  'stock_receipt_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    receiptId: uuid('receipt_id')
      .notNull()
      .references(() => stockReceipt.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'restrict' }),
    quantity: integer('quantity').notNull(),
    unitCostMinor: integer('unit_cost_minor').notNull(),
    movementId: uuid('movement_id')
      .notNull()
      .references(() => stockMovement.id, { onDelete: 'restrict' }),
    /** The ordered line this receipt satisfies; soft reference (see `purchaseOrderId`). */
    purchaseOrderLineId: uuid('purchase_order_line_id'),
    overReceiptReason: overReceiptReasonEnum('over_receipt_reason'),
    overReceiptNote: text('over_receipt_note'),
  },
  (table) => [
    uniqueIndex('stock_receipt_line_receipt_product_unique').on(table.receiptId, table.productId),
    index('stock_receipt_line_purchase_order_line_idx').on(table.purchaseOrderLineId),
  ],
)
