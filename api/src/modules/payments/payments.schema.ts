import { desc, sql } from 'drizzle-orm'
import {
  boolean,
  check,
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
import { device, terminal } from '../org/terminals.schema.ts'
import {
  supplierInvoice,
  supplierPayment,
  supplierPaymentMethodEnum,
} from '../payables/payables.schema.ts'
import { supplier, supplierPaymentDetail } from '../suppliers/suppliers.schema.ts'

export const paymentMethodEnum = pgEnum('payment_method', ['MOMO', 'CARD', 'BANK_TRANSFER'])

/** The implementation that answered, so a mock settlement can never be read as money. */
export const paymentProviderEnum = pgEnum('payment_provider', ['PAYSTACK', 'MOCK'])

/**
 * `PENDING` is a radio silence, not a refusal: a provider timeout, an abandoned
 * handset and a payment awaiting its webhook all look like this until one of
 * them resolves. `ABANDONED`/`EXPIRED` only stop the till waiting; a late
 * settlement may still move the row to `PAID` (P13-D8, P13-D9).
 */
export const paymentStatusEnum = pgEnum('payment_status', [
  'PENDING',
  'PAID',
  'FAILED',
  'ABANDONED',
  'EXPIRED',
])

/**
 * Electronic money, created by the terminal before any sale exists (P13-D6).
 *
 * `shift_id` carries no foreign key on purpose. The dependency has to run one
 * way — `pos` references `payments`, never the reverse — so this file must not
 * import `pos.schema.ts`, while `pos.schema.ts` imports this one for
 * `sale_tender.payment_id`. Both writers lock the shift row before trusting it,
 * so the integrity is enforced where the money is, not by a constraint.
 *
 * No card data is stored: no `bin`, no `last4`, no `authorization`. The raw
 * provider body is projected into `payment_event.detail` and never persisted
 * here (P13-D15).
 */
export const payment = pgTable(
  'payment',
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
    /** No FK: see the table comment. */
    shiftId: uuid('shift_id').notNull(),
    /** uuidv7 minted by the till; `(terminal_id, client_payment_id)` is the idempotency key. */
    clientPaymentId: uuid('client_payment_id').notNull(),
    cashierUserId: text('cashier_user_id').notNull(),
    cashierStaffId: text('cashier_staff_id').notNull(),
    method: paymentMethodEnum('method').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    provider: paymentProviderEnum('provider').notNull(),
    /** Ours, sent to the provider; the sale tender's `reference` is a copy for printing. */
    providerReference: text('provider_reference').notNull(),
    /** A routing label, not a contact channel (P13-D7): never mailed, never shown. */
    providerEmail: text('provider_email').notNull(),
    /** A u64 arrives from the provider as JSON and would lose precision as a number. */
    providerTransactionId: text('provider_transaction_id'),
    status: paymentStatusEnum('status').notNull().default('PENDING'),
    /** The provider's own channel string, kept for reconciliation. */
    channel: text('channel'),
    /** What the till shows the customer at the counter. */
    displayText: text('display_text'),
    /** Card checkout only (P13-D13). */
    authorizationUrl: text('authorization_url'),
    /** Bank transfer only (P13-D14). */
    accountNumber: text('account_number'),
    accountName: text('account_name'),
    accountBank: text('account_bank'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    failedCode: text('failed_code'),
    failedMessage: text('failed_message'),
    /**
     * A payment that settled after its till gave up. It is never auto-refunded:
     * a manager attaches it to a cart or records it (P13-D9).
     */
    orphaned: boolean('orphaned').notNull().default(false),
    /** Set before the verify call so a polling till cannot burn the provider quota (P13-D12). */
    lastVerifiedAt: timestamp('last_verified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('payment_terminal_client_unique').on(table.terminalId, table.clientPaymentId),
    uniqueIndex('payment_provider_reference_unique').on(table.providerReference),
    index('payment_branch_created_idx').on(table.branchId, table.createdAt),
    index('payment_status_created_idx').on(table.status, table.createdAt),
    index('payment_shift_idx').on(table.shiftId),
  ],
)

/**
 * One provider webhook delivery or one verify attempt, deduplicated by body
 * hash. Paystack retries for 72 hours, so a duplicate is the normal case and
 * must insert nothing (P13-D11).
 *
 * `detail` is an allowlisted projection — reference, status, amount, currency,
 * channel, paid_at, gateway_response — never the raw body, tokens or secrets.
 */
export const paymentEvent = pgTable(
  'payment_event',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: paymentProviderEnum('provider').notNull(),
    /** Allowlisted in the service, not free text from the body. */
    eventType: text('event_type').notNull(),
    bodySha256: text('body_sha256').notNull(),
    providerReference: text('provider_reference'),
    paymentId: uuid('payment_id').references(() => payment.id, { onDelete: 'set null' }),
    /**
     * The supplier transfer this delivery is about (P14-D30). Null for charge and
     * refund events; `set null` because an event outlives a deleted intent and the
     * ledger must never lose a delivery that arrived.
     */
    supplierTransferId: uuid('supplier_transfer_id').references(() => supplierTransfer.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull(),
    detail: jsonb('detail').notNull().default({}),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('payment_event_body_unique').on(table.provider, table.bodySha256),
    index('payment_event_payment_idx').on(table.paymentId),
    index('payment_event_transfer_idx').on(table.supplierTransferId),
    index('payment_event_type_received_idx').on(table.eventType, table.receivedAt),
  ],
)

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
 * The table lives beside `payment_event` rather than beside `supplier_payment`
 * because `payment_event` references it (P14-D30): keeping the FK means the
 * import must run `payments → payables`, exactly as `pos → payments` does for
 * `sale_tender.payment_id`. A table that both sides need lives on the side that
 * does not import back.
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
