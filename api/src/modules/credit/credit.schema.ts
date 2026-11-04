import { sql } from 'drizzle-orm'
import {
  boolean,
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
import { customer } from '../customers/customers.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { shift } from '../pos/pos.schema.ts'

export const creditEntryKindEnum = pgEnum('credit_entry_kind', [
  'CHARGE',
  'REPAYMENT',
  'REFUND',
  'ADJUSTMENT',
])

export const creditReasonCodeEnum = pgEnum('credit_reason_code', [
  'SALE',
  'OPENING_BALANCE',
  'CORRECTION',
  'WRITE_OFF',
  'DISPUTE',
  'RETURN',
  'OTHER',
])

export const creditOverrideReasonEnum = pgEnum('credit_override_reason', [
  'TEMPORARY_APPROVAL',
  'TRUSTED_CUSTOMER',
  'URGENT_NEED',
  'OTHER',
])

export const creditMethodEnum = pgEnum('credit_method', ['CASH', 'MOMO', 'BANK'])

/**
 * Branch-local credit entitlement. The balance is a disposable projection:
 * it always equals SUM(amount_minor) of this customer+branch's ledger entries.
 */
export const creditProfile = pgTable(
  'credit_profile',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    limitMinor: integer('limit_minor').notNull().default(0),
    hold: boolean('hold').notNull().default(false),
    paymentTermDays: integer('payment_term_days').notNull().default(0),
    notes: text('notes'),
    balanceMinor: integer('balance_minor').notNull().default(0),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('credit_profile_customer_branch_unique').on(table.customerId, table.branchId),
    index('credit_profile_branch_idx').on(table.branchId),
  ],
)

/**
 * Append-only credit ledger. There are deliberately no update or delete paths
 * for this table: corrections are compensating entries.
 * Sign convention: CHARGE positive (what the customer owes), REPAYMENT and
 * REFUND negative, ADJUSTMENT signed. A negative profile balance is customer
 * credit held at that branch.
 */
export const creditLedgerEntry = pgTable(
  'credit_ledger_entry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    kind: creditEntryKindEnum('kind').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    reasonCode: creditReasonCodeEnum('reason_code'),
    method: creditMethodEnum('method'),
    note: text('note'),
    dueDate: date('due_date'),
    referenceType: text('reference_type'),
    referenceId: uuid('reference_id'),
    referenceNumber: text('reference_number'),
    overrideReason: creditOverrideReasonEnum('override_reason'),
    overriddenBy: text('overridden_by'),
    receivedBy: text('received_by'),
    /**
     * The drawer the money physically landed in (P20-D1).
     *
     * A **cash** repayment collected at a till is money the shift's drawer holds,
     * so it has to name the shift — otherwise the expected-cash arithmetic can
     * never see it and every cash repayment closes as an overage. Repayments taken
     * in the console have no drawer and leave this null; so does every non-cash
     * method, which never touched the notes.
     */
    shiftId: uuid('shift_id').references(() => shift.id, { onDelete: 'restrict' }),
    idempotencyKey: text('idempotency_key'),
    createdBy: text('created_by'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('credit_ledger_entry_customer_branch_idx').on(
      table.customerId,
      table.branchId,
      table.occurredAt,
    ),
    index('credit_ledger_entry_branch_idx').on(table.branchId, table.occurredAt),
    uniqueIndex('credit_ledger_entry_idempotency_unique').on(table.branchId, table.idempotencyKey),
    // A device repayment is posted once per fact it names: the paid payment for
    // MoMo, the upload for cash. The upload ledger already stops a replay; this
    // is what stops the same money being repaid twice by two uploads (P13-D27).
    uniqueIndex('credit_ledger_entry_pos_reference_unique')
      .on(table.referenceId)
      .where(sql`${table.referenceType} = 'POS_REPAYMENT'`),
    // The drawer read: a shift's cash repayments, one index-only-ish scan.
    index('credit_ledger_entry_shift_idx').on(table.shiftId, table.kind, table.method),
  ],
)
