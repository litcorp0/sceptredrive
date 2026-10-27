import {
  boolean,
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
import { paymentProviderEnum, supplierTransfer } from '../payables/payables.schema.ts'

export const paymentMethodEnum = pgEnum('payment_method', ['MOMO', 'CARD', 'BANK_TRANSFER'])

/**
 * `payment_provider` is declared in `payables.schema.ts` because the supplier
 * transfer carries it too, and this file imports that one for the event link.
 */

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
