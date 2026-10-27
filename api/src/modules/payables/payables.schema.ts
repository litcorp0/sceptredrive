import { desc, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  check,
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
import { purchaseOrder, purchaseOrderLine } from '../procurement/procurement.schema.ts'
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

/** How an invoice line compares to the purchase-order line it was matched to (Phase 11). */
export const invoiceMatchStatusEnum = pgEnum('invoice_match_status', [
  'UNMATCHED',
  'MATCHED',
  'PRICE_VARIANCE',
  'QUANTITY_VARIANCE',
  'PRICE_AND_QUANTITY_VARIANCE',
  'NOT_ON_ORDER',
])

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
    /** The order this invoice settles, when the supplier names one (P11-D5). */
    purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrder.id, {
      onDelete: 'restrict',
    }),
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
    index('supplier_invoice_purchase_order_idx').on(table.purchaseOrderId),
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
    /** The ordered line this invoice line was compared to; null when not matched. */
    purchaseOrderLineId: uuid('purchase_order_line_id').references(() => purchaseOrderLine.id, {
      onDelete: 'restrict',
    }),
    /**
     * Advisory only: a variance is recorded so somebody can look, and never
     * blocks the payable (P11-D5).
     */
    matchStatus: invoiceMatchStatusEnum('match_status').notNull().default('UNMATCHED'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('supplier_invoice_line_invoice_idx').on(table.invoiceId),
    uniqueIndex('supplier_invoice_line_product_unique')
      .on(table.invoiceId, table.productId)
      .where(sql`${table.productId} is not null`),
    index('supplier_invoice_line_product_idx').on(table.productId),
    index('supplier_invoice_line_purchase_order_line_idx').on(table.purchaseOrderLineId),
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

/**
 * The implementation that answered, so a mock settlement can never be read as
 * money. Declared here because both `payment` (payments) and `supplier_transfer`
 * (this module) carry it, and the import direction is fixed: `payments.schema.ts`
 * imports this file for the transfer FK, never the reverse.
 */
export const paymentProviderEnum = pgEnum('payment_provider', ['PAYSTACK', 'MOCK'])

/**
 * The supplier-transfer state machine (P14-D24). `AWAITING_OTP` is a real state,
 * not an error: with "confirm transfers before sending" enabled every transfer
 * starts there. Only `SUCCESS` moved money; `REVERSED` is money that came back.
 */
export const supplierTransferStatusEnum = pgEnum('supplier_transfer_status', [
  'PENDING',
  'AWAITING_OTP',
  'SUCCESS',
  'FAILED',
  'REVERSED',
  'BLOCKED',
  'REJECTED',
])

/**
 * What we asked Paystack to pay, never the payment itself (P14-D22/P14-D23).
 *
 * A transfer is an instruction with its own lifecycle; `supplier_payment` stays
 * the only ledger fact and is written by `transfer.success` through the same
 * allocation core the manual form uses. Putting a `PENDING` payment in its place
 * would put un-moved money into the invoice projection and the ageing buckets.
 *
 * It lives in this module because it is a payable: `payment_event` in the
 * payments module references it (P14-D30), so the import runs `payments →
 * payables`, exactly as `pos.schema.ts` imports `payments.schema.ts` for
 * `sale_tender.payment_id`. A table both sides need lives on the side that does
 * not import back.
 *
 * The reference is server-minted (`sdt-<uuid>`): Paystack's alphabet, 16–50
 * characters. `idempotency_key` is the client's, so a retried initiation returns
 * the transfer it already created. `provider_transfer_id` is Paystack's u64 id
 * stored as text — a JavaScript number would round it.
 */
export const supplierTransfer = pgTable(
  'supplier_transfer',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => supplier.id, { onDelete: 'restrict' }),
    paymentDetailId: uuid('payment_detail_id')
      .notNull()
      .references(() => supplierPaymentDetail.id, { onDelete: 'restrict' }),
    /** `BANK` or `MOMO`; `CASH` never leaves by transfer and the service refuses it. */
    method: supplierPaymentMethodEnum('method').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    reference: text('reference').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    status: supplierTransferStatusEnum('status').notNull().default('PENDING'),
    provider: paymentProviderEnum('provider').notNull(),
    /** The destination Paystack accepted. Never returned by the read API (P14-D28). */
    recipientCode: text('recipient_code'),
    /** `TRF_…` as the provider minted it. */
    providerTransferCode: text('provider_transfer_code'),
    providerTransferId: text('provider_transfer_id'),
    /** The narration sent to the provider. */
    reason: text('reason').notNull(),
    note: text('note'),
    failureCode: text('failure_code'),
    failureMessage: text('failure_message'),
    /** Set exactly once, on settlement; one payment per transfer and one transfer per payment. */
    paymentId: uuid('payment_id').references(() => supplierPayment.id, { onDelete: 'set null' }),
    /** What the plan could not apply: the remainder stays on account (P14-D26). */
    unallocatedMinor: integer('unallocated_minor').notNull().default(0),
    initiatedBy: text('initiated_by'),
    finalizedAt: timestamp('finalized_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('supplier_transfer_reference_unique').on(table.reference),
    uniqueIndex('supplier_transfer_idempotency_unique').on(table.branchId, table.idempotencyKey),
    uniqueIndex('supplier_transfer_payment_unique')
      .on(table.paymentId)
      .where(sql`${table.paymentId} is not null`),
    index('supplier_transfer_branch_created_idx').on(table.branchId, desc(table.createdAt)),
    // The catch-up sweep reads the open statuses oldest-first (P14-D31, P14-D47).
    index('supplier_transfer_status_created_idx').on(table.status, table.createdAt),
    index('supplier_transfer_supplier_created_idx').on(table.supplierId, desc(table.createdAt)),
    check('supplier_transfer_amount_positive', sql`${table.amountMinor} > 0`),
    check(
      'supplier_transfer_reference_length',
      sql`char_length(${table.reference}) between 16 and 50`,
    ),
  ],
)

/**
 * The allocation *plan*: which invoices the transfer is meant to settle.
 *
 * The settled rows are still written to `supplier_payment_allocation` on
 * `transfer.success`, which keeps `supplier_payment` the only ledger fact. The
 * two can disagree — an invoice paid by hand meanwhile — and the difference is
 * reported as `unallocated_minor` rather than hidden (P14-D26).
 */
export const supplierTransferAllocation = pgTable(
  'supplier_transfer_allocation',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    transferId: uuid('transfer_id')
      .notNull()
      .references(() => supplierTransfer.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => supplierInvoice.id, { onDelete: 'restrict' }),
    amountMinor: integer('amount_minor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('supplier_transfer_allocation_transfer_invoice_unique').on(
      table.transferId,
      table.invoiceId,
    ),
    check('supplier_transfer_allocation_amount_positive', sql`${table.amountMinor} > 0`),
  ],
)
