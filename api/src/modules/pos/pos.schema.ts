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
import { customer } from '../customers/customers.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import { product } from '../products/products.schema.ts'

export const shiftStatusEnum = pgEnum('shift_status', ['OPEN', 'CLOSED'])

export const cashMovementTypeEnum = pgEnum('cash_movement_type', ['CASH_IN', 'CASH_OUT'])

export const saleTenderMethodEnum = pgEnum('sale_tender_method', ['CASH', 'CREDIT'])

export const posTransactionTypeEnum = pgEnum('pos_transaction_type', [
  'SALE',
  'SHIFT_OPEN',
  'CASH_MOVEMENT',
  'SHIFT_CLOSE',
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

export const saleTender = pgTable(
  'sale_tender',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    saleId: uuid('sale_id')
      .notNull()
      .references(() => sale.id, { onDelete: 'cascade' }),
    method: saleTenderMethodEnum('method').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    reference: text('reference'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('sale_tender_sale_idx').on(table.saleId),
    uniqueIndex('sale_tender_sale_method_unique').on(table.saleId, table.method),
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
