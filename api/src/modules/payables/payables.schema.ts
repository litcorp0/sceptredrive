import { sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
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
import { stockReceipt } from '../inventory/inventory.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { product } from '../products/products.schema.ts'
import { supplier, supplierPaymentDetail } from '../suppliers/suppliers.schema.ts'

export const supplierInvoiceStatusEnum = pgEnum('supplier_invoice_status', [
  'OPEN',
  'PARTIAL',
  'PAID',
  'VOID',
])

export const supplierInvoiceVoidReasonEnum = pgEnum('supplier_invoice_void_reason', [
  'DUPLICATE',
  'CANCELLED',
  'ERROR',
  'OTHER',
])

/** PAYSTACK joins this enum in Phase 8 when supplier transfers go live. */
export const supplierPaymentMethodEnum = pgEnum('supplier_payment_method', ['CASH', 'BANK', 'MOMO'])

export const supplierPaymentStatusEnum = pgEnum('supplier_payment_status', ['COMPLETED', 'VOID'])

export const supplierPaymentVoidReasonEnum = pgEnum('supplier_payment_void_reason', [
  'DUPLICATE',
  'ERROR',
  'RETURNED',
  'BANK_REVERSAL',
  'OTHER',
])

export const supplierAllocationKindEnum = pgEnum('supplier_allocation_kind', ['APPLY', 'RELEASE'])

/**
 * A supplier invoice (bill): branch-scoped, optionally recorded from a stock
 * receipt. `amountPaidMinor` and `status` are projections recomputed from the
 * allocation ledger on every write — never authoritative on their own.
 * Rows are never deleted: voiding flips status and stamps the reason.
 */
export const supplierInvoice = pgTable(
  'supplier_invoice',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => supplier.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    supplierInvoiceNumber: text('supplier_invoice_number').notNull(),
    invoiceDate: date('invoice_date').notNull(),
    dueDate: date('due_date').notNull(),
    receiptId: uuid('receipt_id').references(() => stockReceipt.id, { onDelete: 'restrict' }),
    subtotalMinor: integer('subtotal_minor').notNull(),
    vatMinor: integer('vat_minor').notNull().default(0),
    nhilMinor: integer('nhil_minor').notNull().default(0),
    getfundMinor: integer('getfund_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull(),
    amountPaidMinor: integer('amount_paid_minor').notNull().default(0),
    status: supplierInvoiceStatusEnum('status').notNull().default('OPEN'),
    voidReason: supplierInvoiceVoidReasonEnum('void_reason'),
    voidedBy: text('voided_by'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    note: text('note'),
    idempotencyKey: text('idempotency_key'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('supplier_invoice_number_unique').on(table.number),
    uniqueIndex('supplier_invoice_idempotency_unique').on(table.branchId, table.idempotencyKey),
    uniqueIndex('supplier_invoice_supplier_number_unique')
      .on(table.supplierId, table.branchId, table.supplierInvoiceNumber)
      .where(sql`${table.status} <> 'VOID'`),
    uniqueIndex('supplier_invoice_receipt_unique')
      .on(table.receiptId)
      .where(sql`${table.receiptId} is not null`),
    index('supplier_invoice_branch_status_due_idx').on(table.branchId, table.status, table.dueDate),
    index('supplier_invoice_supplier_status_idx').on(table.supplierId, table.status),
  ],
)

/** Invoice lines: product-linked or description-only (freight, services). */
export const supplierInvoiceLine = pgTable(
  'supplier_invoice_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => supplierInvoice.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').references(() => product.id, { onDelete: 'restrict' }),
    description: text('description'),
    quantity: integer('quantity').notNull(),
    unitCostMinor: integer('unit_cost_minor').notNull(),
    lineTotalMinor: integer('line_total_minor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('supplier_invoice_line_invoice_idx').on(table.invoiceId),
    uniqueIndex('supplier_invoice_line_product_unique')
      .on(table.invoiceId, table.productId)
      .where(sql`${table.productId} is not null`),
    index('supplier_invoice_line_product_idx').on(table.productId),
  ],
)

/**
 * A payment made to a supplier. Voiding releases its allocations through
 * compensating RELEASE rows; the payment row itself is never deleted.
 */
export const supplierPayment = pgTable(
  'supplier_payment',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => supplier.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    method: supplierPaymentMethodEnum('method').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    reference: text('reference'),
    paidAt: timestamp('paid_at', { withTimezone: true }).notNull(),
    paymentDetailId: uuid('payment_detail_id').references(() => supplierPaymentDetail.id, {
      onDelete: 'restrict',
    }),
    status: supplierPaymentStatusEnum('status').notNull().default('COMPLETED'),
    voidReason: supplierPaymentVoidReasonEnum('void_reason'),
    voidedBy: text('voided_by'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    note: text('note'),
    idempotencyKey: text('idempotency_key'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('supplier_payment_number_unique').on(table.number),
    uniqueIndex('supplier_payment_idempotency_unique').on(table.branchId, table.idempotencyKey),
    index('supplier_payment_supplier_paid_idx').on(table.supplierId, table.paidAt),
    index('supplier_payment_branch_paid_idx').on(table.branchId, table.paidAt),
    index('supplier_payment_status_idx').on(table.status),
  ],
)

/**
 * Append-only allocation ledger. APPLY rows are positive, RELEASE rows negative;
 * a release always points at the allocation it reverses. Invoice paid amounts
 * are recomputed from this ledger.
 */
export const supplierPaymentAllocation = pgTable(
  'supplier_payment_allocation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => supplierPayment.id, { onDelete: 'restrict' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => supplierInvoice.id, { onDelete: 'restrict' }),
    kind: supplierAllocationKindEnum('kind').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    reversesAllocationId: uuid('reverses_allocation_id').references(
      (): AnyPgColumn => supplierPaymentAllocation.id,
      { onDelete: 'restrict' },
    ),
    note: text('note'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('supplier_payment_allocation_payment_idx').on(table.paymentId),
    index('supplier_payment_allocation_invoice_idx').on(table.invoiceId),
    index('supplier_payment_allocation_reverses_idx').on(table.reversesAllocationId),
  ],
)
