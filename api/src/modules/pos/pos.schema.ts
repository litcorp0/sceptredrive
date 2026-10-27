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
import { approval } from '../approvals/approvals.schema.ts'
import { customer } from '../customers/customers.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import { payment } from '../payments/payments.schema.ts'
import { product } from '../products/products.schema.ts'

export const shiftStatusEnum = pgEnum('shift_status', ['OPEN', 'CLOSED'])

/**
 * Variance review state (Phase 12, BRN-04). It is a column, not a `shift_status`
 * value: the reconciliation query filters `status = 'CLOSED'`, so a review status
 * would silently drop those shifts out of reconciliation (P12-D24).
 */
export const shiftReviewStatusEnum = pgEnum('shift_review_status', ['NONE', 'REQUIRED', 'REVIEWED'])

/** The review state vocabulary, derived from the enum so there is one source. */
export type ShiftReviewStatus = (typeof shiftReviewStatusEnum.enumValues)[number]

export const cashMovementTypeEnum = pgEnum('cash_movement_type', ['CASH_IN', 'CASH_OUT'])

/**
 * The five ways money reaches a sale (P13-D1). `MOMO`, `CARD` and
 * `BANK_TRANSFER` arrive in the enum-only Phase 13 migration: a value added in
 * the same transaction cannot be used there.
 */
export const saleTenderMethodEnum = pgEnum('sale_tender_method', [
  'CASH',
  'CREDIT',
  'MOMO',
  'CARD',
  'BANK_TRANSFER',
])

export const posTransactionTypeEnum = pgEnum('pos_transaction_type', [
  'SALE',
  'SHIFT_OPEN',
  'CASH_MOVEMENT',
  'SHIFT_CLOSE',
  // Phase 13 outbox types, each added by the enum-only migration (P13-D18,
  // P13-D27, P13-D28).
  'REFUND',
  'CREDIT_REPAYMENT',
  'CART_VOID',
])

export const syncConflictTypeEnum = pgEnum('sync_conflict_type', [
  'STOCK_OVERSELL',
  'CREDIT_OVER_LIMIT',
  'CREDIT_HOLD',
  'LOYALTY_NEGATIVE',
  'LOYALTY_RATE_CHANGED',
  'PRICE_MISMATCH',
  'TOTAL_MISMATCH',
  'SHIFT_VARIANCE_MISMATCH',
  'STALE_CREDENTIALS',
  'OVERRIDE_INVALID',
  'DUPLICATE_CUSTOMER',
  'CLOCK_SKEW',
  'INVALID_CUSTOMER',
  'UNKNOWN_PRODUCT',
  // Phase 13 payment conflicts. `SyncConflictType` is asserted equal to this
  // list, in order, by the phase 13 schema test, so the two move together.
  'PAYMENT_LATE_SETTLEMENT',
  'PAYMENT_AMOUNT_MISMATCH',
])

export const syncConflictSeverityEnum = pgEnum('sync_conflict_severity', ['LOW', 'MEDIUM', 'HIGH'])

export const syncConflictStatusEnum = pgEnum('sync_conflict_status', [
  'OPEN',
  'RESOLVED',
  'DISMISSED',
])

/** One cashier's shift on one terminal. At most one OPEN shift per terminal. */
export const shift = pgTable(
  'shift',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    number: text('number').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    terminalId: uuid('terminal_id')
      .notNull()
      .references(() => terminal.id, { onDelete: 'restrict' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'restrict' }),
    cashierUserId: text('cashier_user_id').notNull(),
    cashierStaffId: text('cashier_staff_id').notNull(),
    status: shiftStatusEnum('status').notNull().default('OPEN'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    openingFloatMinor: integer('opening_float_minor').notNull().default(0),
    countedCashMinor: integer('counted_cash_minor'),
    clientExpectedCashMinor: integer('client_expected_cash_minor'),
    serverExpectedCashMinor: integer('server_expected_cash_minor'),
    varianceMinor: integer('variance_minor'),
    reviewStatus: shiftReviewStatusEnum('review_status').notNull().default('NONE'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewNote: text('review_note'),
    closeNote: text('close_note'),
    openedBy: text('opened_by'),
    closedBy: text('closed_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('shift_number_unique').on(table.number),
    uniqueIndex('shift_one_open_per_terminal')
      .on(table.terminalId)
      .where(sql`${table.status} = 'OPEN'`),
    index('shift_branch_opened_idx').on(table.branchId, table.openedAt),
    index('shift_terminal_opened_idx').on(table.terminalId, table.openedAt),
    index('shift_review_idx').on(table.branchId, table.reviewStatus, table.closedAt),
  ],
)

/**
 * A completed sale. The client captures the UUID and receipt number offline;
 * the server recomputes prices/tax/credit/loyalty but keeps the charged money
 * as the fact of the sale.
 */
export const sale = pgTable(
  'sale',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    receiptNumber: text('receipt_number').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    terminalId: uuid('terminal_id')
      .notNull()
      .references(() => terminal.id, { onDelete: 'restrict' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'restrict' }),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shift.id, { onDelete: 'restrict' }),
    clientTransactionId: uuid('client_transaction_id').notNull(),
    cashierUserId: text('cashier_user_id').notNull(),
    cashierStaffId: text('cashier_staff_id').notNull(),
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'restrict' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    subtotalMinor: integer('subtotal_minor').notNull(),
    lineDiscountMinor: integer('line_discount_minor').notNull().default(0),
    saleDiscountMinor: integer('sale_discount_minor').notNull().default(0),
    loyaltyRedeemPoints: integer('loyalty_redeem_points').notNull().default(0),
    loyaltyDiscountMinor: integer('loyalty_discount_minor').notNull().default(0),
    vatMinor: integer('vat_minor').notNull().default(0),
    nhilMinor: integer('nhil_minor').notNull().default(0),
    getfundMinor: integer('getfund_minor').notNull().default(0),
    taxTotalMinor: integer('tax_total_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull(),
    tenderTotalMinor: integer('tender_total_minor').notNull(),
    changeMinor: integer('change_minor').notNull().default(0),
    loyaltyEarnedPoints: integer('loyalty_earned_points').notNull().default(0),
    creditAmountMinor: integer('credit_amount_minor').notNull().default(0),
    taxMode: text('tax_mode').notNull(),
    conflictCount: integer('conflict_count').notNull().default(0),
    appVersion: text('app_version'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sale_receipt_number_unique').on(table.receiptNumber),
    uniqueIndex('sale_terminal_client_transaction_unique').on(
      table.terminalId,
      table.clientTransactionId,
    ),
    index('sale_branch_occurred_idx').on(table.branchId, table.occurredAt),
    index('sale_terminal_occurred_idx').on(table.terminalId, table.occurredAt),
    index('sale_customer_occurred_idx').on(table.customerId, table.occurredAt),
    index('sale_shift_idx').on(table.shiftId),
  ],
)

export const saleLine = pgTable(
  'sale_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sale.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'restrict' }),
    lineNumber: integer('line_number').notNull(),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    barcode: text('barcode'),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: integer('unit_price_minor').notNull(),
    expectedUnitPriceMinor: integer('expected_unit_price_minor').notNull(),
    lineDiscountMinor: integer('line_discount_minor').notNull().default(0),
    saleDiscountMinor: integer('sale_discount_minor').notNull().default(0),
    loyaltyDiscountMinor: integer('loyalty_discount_minor').notNull().default(0),
    netMinor: integer('net_minor').notNull(),
    taxableMinor: integer('taxable_minor').notNull(),
    baseMinor: integer('base_minor').notNull(),
    vatMinor: integer('vat_minor').notNull(),
    nhilMinor: integer('nhil_minor').notNull(),
    getfundMinor: integer('getfund_minor').notNull(),
    taxTotalMinor: integer('tax_total_minor').notNull(),
    totalMinor: integer('total_minor').notNull(),
    taxCategory: text('tax_category').notNull(),
    unitCostMinor: integer('unit_cost_minor').notNull().default(0),
    priceSource: text('price_source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sale_line_sale_number_unique').on(table.saleId, table.lineNumber),
    index('sale_line_sale_idx').on(table.saleId),
    index('sale_line_product_idx').on(table.productId),
  ],
)

/**
 * One tender line on a sale. The sale row is written once and only when the
 * tenders cover it (P13-D5), so a tender is money that was received, never a
 * pending intent; the `payment` row carries any electronic status.
 */
export const saleTender = pgTable(
  'sale_tender',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sale.id, { onDelete: 'cascade' }),
    /** The receipt's order: GH₵50 cash then GH₵50 MoMo must print that way (P13-D1). */
    sequence: integer('sequence').notNull().default(1),
    method: saleTenderMethodEnum('method').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    /**
     * The real link for an electronic tender. `reference` below is a display
     * copy of the provider reference, kept for printing and disputes.
     */
    paymentId: uuid('payment_id').references(() => payment.id, { onDelete: 'restrict' }),
    reference: text('reference'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sale_tender_sale_idx').on(table.saleId),
    uniqueIndex('sale_tender_sale_sequence_unique').on(table.saleId, table.sequence),
    // One payment settles one tender, ever: a retry cannot spend GH₵50 twice
    // (P13-D6). Cash and credit rows carry no payment, so the partial predicate
    // keeps them out of the index.
    uniqueIndex('sale_tender_payment_unique')
      .on(table.paymentId)
      .where(sql`${table.paymentId} is not null`),
    index('sale_tender_payment_idx').on(table.paymentId),
  ],
)

export const cashMovement = pgTable(
  'cash_movement',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shift.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    terminalId: uuid('terminal_id')
      .notNull()
      .references(() => terminal.id, { onDelete: 'restrict' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'restrict' }),
    type: cashMovementTypeEnum('type').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    reason: text('reason').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    staffUserId: text('staff_user_id').notNull(),
    staffStaffId: text('staff_staff_id').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    createdBy: text('created_by'),
  },
  (table) => [
    index('cash_movement_shift_occurred_idx').on(table.shiftId, table.occurredAt),
    index('cash_movement_branch_occurred_idx').on(table.branchId, table.occurredAt),
  ],
)

/** Processed client transactions; the (terminal, clientTransactionId) pair is the idempotency key. */
export const posSyncTransaction = pgTable(
  'pos_sync_transaction',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    terminalId: uuid('terminal_id')
      .notNull()
      .references(() => terminal.id, { onDelete: 'restrict' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'restrict' }),
    clientTransactionId: uuid('client_transaction_id').notNull(),
    type: posTransactionTypeEnum('type').notNull(),
    status: text('status').notNull(),
    result: jsonb('result').notNull().default({}),
    conflictCount: integer('conflict_count').notNull().default(0),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('pos_sync_transaction_client_unique').on(
      table.terminalId,
      table.clientTransactionId,
    ),
    index('pos_sync_transaction_terminal_applied_idx').on(table.terminalId, table.appliedAt),
  ],
)

/** Business conflicts from offline sales; applied but flagged for manager review. */
export const syncConflict = pgTable(
  'sync_conflict',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    terminalId: uuid('terminal_id')
      .notNull()
      .references(() => terminal.id, { onDelete: 'restrict' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'restrict' }),
    saleId: uuid('sale_id').references(() => sale.id, { onDelete: 'set null' }),
    shiftId: uuid('shift_id').references(() => shift.id, { onDelete: 'set null' }),
    type: syncConflictTypeEnum('type').notNull(),
    severity: syncConflictSeverityEnum('severity').notNull(),
    status: syncConflictStatusEnum('status').notNull().default('OPEN'),
    details: jsonb('details').notNull().default({}),
    resolvedBy: text('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sync_conflict_branch_status_idx').on(table.branchId, table.status, table.severity),
    index('sync_conflict_terminal_created_idx').on(table.terminalId, table.createdAt),
    index('sync_conflict_sale_idx').on(table.saleId),
    // The nightly oversell scan reads one type over a 30-day window (P12-D32).
    index('sync_conflict_type_created_idx').on(table.type, table.createdAt),
  ],
)

/**
 * A staff member authorized to use a terminal offline. The raw binding token
 * is returned once and stored hashed; PIN changes/revocation invalidate it.
 */
export const posStaffBinding = pgTable(
  'pos_staff_binding',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'restrict' }),
    staffUserId: text('staff_user_id').notNull(),
    staffStaffId: text('staff_staff_id').notNull(),
    role: text('role').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    pinVersion: integer('pin_version').notNull(),
    bindingTokenHash: text('binding_token_hash').notNull(),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('pos_staff_binding_active_unique')
      .on(table.deviceId, table.staffUserId)
      .where(sql`${table.revokedAt} is null`),
    index('pos_staff_binding_device_staff_idx').on(table.deviceId, table.staffUserId),
    index('pos_staff_binding_staff_idx').on(table.staffUserId),
  ],
)

// --- Phase 13: refunds, cart voids and the shift report ----------------------

/** Why the customer brought the goods back (P13-D17). */
export const refundReasonEnum = pgEnum('refund_reason', [
  'CUSTOMER_CHANGED_MIND',
  'WRONG_ITEM',
  'DEFECTIVE',
  'PRICE_DISPUTE',
  'DUPLICATE_SALE',
  'OTHER',
])

/**
 * What happened to the goods. Only `RESALABLE` posts a stock movement: a
 * `DAMAGED` line is reported as damage, not written off, because the sale
 * already removed the unit and a write-off would decrement twice (P13-D22).
 */
export const refundRestockEnum = pgEnum('refund_restock', ['RESALABLE', 'DAMAGED', 'NOT_RETURNED'])

/**
 * Cash and credit rows settle at write time; electronic rows settle by webhook
 * or provider callback. `NEEDS_ATTENTION` is a provider failure the manager has
 * not yet resolved — it is never silently retried into `SETTLED` (P13-D26).
 */
export const refundTenderStatusEnum = pgEnum('refund_tender_status', [
  'SETTLED',
  'PENDING',
  'FAILED',
  'NEEDS_ATTENTION',
])

/** Why a cart was abandoned before it became a sale (P13-D28). */
export const cartVoidReasonEnum = pgEnum('cart_void_reason', [
  'CUSTOMER_CHANGED_MIND',
  'WRONG_ITEM',
  'PRICE_DISPUTE',
  'DUPLICATE_SCAN',
  'CUSTOMER_LEFT',
  'OTHER',
])

/**
 * A refund is a new document, never an edit to the sale (P13-D17). Its `id` is
 * the upload's `clientTransactionId`, so a replayed `REFUND` collides on the
 * primary key before `pos_sync_transaction` is even consulted (P13-D18).
 *
 * The number is allocated by the till from its local `document_sequence` so a
 * refund can be numbered with the cable unplugged; the server only stores it and
 * enforces uniqueness. There is deliberately no server-side refund sequence
 * setting, because nothing on the server would write it (P13-D37).
 */
export const refund = pgTable(
  'refund',
  {
    id: uuid('id').primaryKey(),
    number: text('number').notNull(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sale.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    terminalId: uuid('terminal_id')
      .notNull()
      .references(() => terminal.id, { onDelete: 'restrict' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'restrict' }),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shift.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id').references(() => customer.id, { onDelete: 'set null' }),
    reasonCode: refundReasonEnum('reason_code').notNull(),
    note: text('note'),
    /** Gross, tax included: what the customer actually gets (P13-D21). */
    refundedMinor: integer('refunded_minor').notNull(),
    /** The tax reversal computed through `taxBreakdown`, never `× 0.2` (P13-D17). */
    baseMinor: integer('base_minor').notNull().default(0),
    vatMinor: integer('vat_minor').notNull().default(0),
    nhilMinor: integer('nhil_minor').notNull().default(0),
    getfundMinor: integer('getfund_minor').notNull().default(0),
    taxTotalMinor: integer('tax_total_minor').notNull().default(0),
    /** The manager PIN proof; authority is proven once per document (P13-D24). */
    approvedByUserId: text('approved_by_user_id').notNull(),
    approvedByStaffId: text('approved_by_staff_id').notNull(),
    approvalPinVersion: integer('approval_pin_version').notNull(),
    approvalReasonCode: text('approval_reason_code').notNull(),
    approvedAt: timestamp('approved_at', { withTimezone: true }).notNull(),
    /** Set when the gross refund crossed `pos.refundApprovalThresholdMinor` (P13-D21). */
    approvalId: uuid('approval_id').references(() => approval.id, { onDelete: 'restrict' }),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('refund_number_unique').on(table.number),
    index('refund_sale_idx').on(table.saleId),
    index('refund_branch_occurred_idx').on(table.branchId, table.occurredAt),
    index('refund_shift_idx').on(table.shiftId),
  ],
)

/**
 * One line of a refund, tied to the `sale_line` it unwinds. The cap
 * (`sale_line.quantity − Σ refunded quantity`) is a query on this table under a
 * lock on the sale row; a cap that is not tied to a row is a cap a retry can
 * exceed (P13-D19).
 */
export const refundLine = pgTable(
  'refund_line',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    refundId: uuid('refund_id')
      .notNull()
      .references(() => refund.id, { onDelete: 'cascade' }),
    saleLineId: uuid('sale_line_id')
      .notNull()
      .references(() => saleLine.id, { onDelete: 'restrict' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => product.id, { onDelete: 'restrict' }),
    lineNumber: integer('line_number').notNull(),
    quantity: integer('quantity').notNull(),
    unitPriceMinor: integer('unit_price_minor').notNull(),
    unitCostMinor: integer('unit_cost_minor').notNull().default(0),
    restock: refundRestockEnum('restock').notNull(),
    /** Required for `DAMAGED`, the only variant that has a reason (P13-D22). */
    damageReason: text('damage_reason'),
    baseMinor: integer('base_minor').notNull().default(0),
    vatMinor: integer('vat_minor').notNull().default(0),
    nhilMinor: integer('nhil_minor').notNull().default(0),
    getfundMinor: integer('getfund_minor').notNull().default(0),
    taxTotalMinor: integer('tax_total_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('refund_line_refund_number_unique').on(table.refundId, table.lineNumber),
    index('refund_line_sale_line_idx').on(table.saleLineId),
  ],
)

/**
 * The refund's allocation across the sale's tenders, chosen by the cashier
 * (P13-D19). `Σ amount ≤ sale_tender.amount_minor` per row, and across the sale
 * `Σ ≤ sale.tender_total_minor − sale.change_minor`: change was never money we
 * kept, so it is not refundable.
 */
export const refundTender = pgTable(
  'refund_tender',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    refundId: uuid('refund_id')
      .notNull()
      .references(() => refund.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull().default(1),
    method: saleTenderMethodEnum('method').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    saleTenderId: uuid('sale_tender_id')
      .notNull()
      .references(() => saleTender.id, { onDelete: 'restrict' }),
    paymentId: uuid('payment_id').references(() => payment.id, { onDelete: 'restrict' }),
    /** The provider's refund id, stored after dispatch succeeds (P13-D26). */
    providerRefundReference: text('provider_refund_reference'),
    status: refundTenderStatusEnum('status').notNull().default('SETTLED'),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    failedMessage: text('failed_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('refund_tender_refund_sequence_unique').on(table.refundId, table.sequence),
    index('refund_tender_sale_tender_idx').on(table.saleTenderId),
    index('refund_tender_provider_reference_idx').on(table.providerRefundReference),
  ],
)

/**
 * A cart abandoned before it became a sale. It carries no money and needs no
 * PIN: a void that required a manager would be a void that never gets recorded,
 * which is how shrink hides (P13-D28). The row exists so Phase 14 can report it.
 */
export const cartVoid = pgTable(
  'cart_void',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    terminalId: uuid('terminal_id')
      .notNull()
      .references(() => terminal.id, { onDelete: 'restrict' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'restrict' }),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shift.id, { onDelete: 'restrict' }),
    cashierUserId: text('cashier_user_id').notNull(),
    cashierStaffId: text('cashier_staff_id').notNull(),
    reasonCode: cartVoidReasonEnum('reason_code').notNull(),
    /** `OTHER` requires at least three characters; the service enforces it. */
    note: text('note'),
    itemCount: integer('item_count').notNull().default(0),
    grossMinor: integer('gross_minor').notNull().default(0),
    label: text('label'),
    /** The abandoned cart as it stood, so the void can be read, not just counted. */
    lines: jsonb('lines').notNull().default([]),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('cart_void_branch_occurred_idx').on(table.branchId, table.occurredAt),
    index('cart_void_terminal_occurred_idx').on(table.terminalId, table.occurredAt),
    index('cart_void_reason_idx').on(table.reasonCode),
  ],
)

/**
 * The Z-report: an immutable snapshot written by `closeShift` inside the same
 * transaction that writes the close (P13-D32). There is no update and no delete
 * path anywhere; a correction after the fact is a new document, never an edit.
 */
export const shiftReport = pgTable(
  'shift_report',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    shiftId: uuid('shift_id')
      .notNull()
      .references(() => shift.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    terminalId: uuid('terminal_id')
      .notNull()
      .references(() => terminal.id, { onDelete: 'restrict' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => device.id, { onDelete: 'restrict' }),
    number: text('number').notNull(),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }).notNull(),
    openingFloatMinor: integer('opening_float_minor').notNull().default(0),
    saleCount: integer('sale_count').notNull().default(0),
    itemCount: integer('item_count').notNull().default(0),
    refundCount: integer('refund_count').notNull().default(0),
    voidCount: integer('void_count').notNull().default(0),
    grossMinor: integer('gross_minor').notNull().default(0),
    refundMinor: integer('refund_minor').notNull().default(0),
    netMinor: integer('net_minor').notNull().default(0),
    lineDiscountMinor: integer('line_discount_minor').notNull().default(0),
    saleDiscountMinor: integer('sale_discount_minor').notNull().default(0),
    loyaltyDiscountMinor: integer('loyalty_discount_minor').notNull().default(0),
    loyaltyRedeemPoints: integer('loyalty_redeem_points').notNull().default(0),
    loyaltyEarnedPoints: integer('loyalty_earned_points').notNull().default(0),
    baseMinor: integer('base_minor').notNull().default(0),
    vatMinor: integer('vat_minor').notNull().default(0),
    nhilMinor: integer('nhil_minor').notNull().default(0),
    getfundMinor: integer('getfund_minor').notNull().default(0),
    taxTotalMinor: integer('tax_total_minor').notNull().default(0),
    cashMinor: integer('cash_minor').notNull().default(0),
    creditMinor: integer('credit_minor').notNull().default(0),
    momoMinor: integer('momo_minor').notNull().default(0),
    cardMinor: integer('card_minor').notNull().default(0),
    bankTransferMinor: integer('bank_transfer_minor').notNull().default(0),
    changeMinor: integer('change_minor').notNull().default(0),
    cashInMinor: integer('cash_in_minor').notNull().default(0),
    cashOutMinor: integer('cash_out_minor').notNull().default(0),
    expectedCashMinor: integer('expected_cash_minor').notNull().default(0),
    countedCashMinor: integer('counted_cash_minor').notNull().default(0),
    varianceMinor: integer('variance_minor').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // One report per shift: a second close cannot overwrite the first.
    uniqueIndex('shift_report_shift_unique').on(table.shiftId),
    index('shift_report_branch_closed_idx').on(table.branchId, table.closedAt),
  ],
)
