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
])

export const stockMovementReferenceEnum = pgEnum('stock_movement_reference', [
  'RECEIPT',
  'ADJUSTMENT',
  'TRANSFER',
  'COUNT',
  'SALE',
])

export const stockAdjustmentReasonEnum = pgEnum('stock_adjustment_reason', [
  'DAMAGE',
  'LOSS',
  'FOUND',
  'CORRECTION',
  'EXPIRED',
  'OTHER',
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
    note: text('note'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('stock_receipt_number_unique').on(table.number),
    index('stock_receipt_branch_idx').on(table.branchId, table.createdAt),
    index('stock_receipt_supplier_idx').on(table.supplierId),
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
  },
  (table) => [
    uniqueIndex('stock_receipt_line_receipt_product_unique').on(table.receiptId, table.productId),
  ],
)
