import { sql } from 'drizzle-orm'
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
import { customer } from '../customers/customers.schema.ts'
import { branch } from '../org/branches.schema.ts'

export const loyaltyEntryKindEnum = pgEnum('loyalty_entry_kind', [
  'EARN',
  'REDEEM',
  'CLAWBACK',
  'ADJUST',
  'EXPIRE',
])

export const loyaltyReasonCodeEnum = pgEnum('loyalty_reason_code', [
  'EXPIRY',
  'RETURN',
  'CORRECTION',
  'GOODWILL',
  'OTHER',
])

/**
 * Global loyalty account per customer. The balance is a disposable projection:
 * it always equals SUM(points_delta) of this account's ledger entries.
 */
export const loyaltyAccount = pgTable(
  'loyalty_account',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    customerId: uuid('customer_id')
      .notNull()
      .unique()
      .references(() => customer.id, { onDelete: 'restrict' }),
    balancePoints: integer('balance_points').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index('loyalty_account_customer_idx').on(table.customerId)],
)

/**
 * Append-only loyalty ledger. There are deliberately no update or delete paths
 * for this table: corrections are compensating entries.
 * EXPIRE entries are global (branch_id null, created_by null — written by the
 * expiry job); activity entries carry the posting branch.
 */
export const loyaltyLedgerEntry = pgTable(
  'loyalty_ledger_entry',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => loyaltyAccount.id, { onDelete: 'restrict' }),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customer.id, { onDelete: 'restrict' }),
    branchId: uuid('branch_id').references(() => branch.id, { onDelete: 'restrict' }),
    kind: loyaltyEntryKindEnum('kind').notNull(),
    pointsDelta: integer('points_delta').notNull(),
    reasonCode: loyaltyReasonCodeEnum('reason_code'),
    note: text('note'),
    referenceType: text('reference_type'),
    referenceId: uuid('reference_id'),
    referenceNumber: text('reference_number'),
    idempotencyKey: text('idempotency_key'),
    createdBy: text('created_by'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('loyalty_ledger_entry_account_idx').on(table.accountId, table.occurredAt),
    index('loyalty_ledger_entry_customer_idx').on(table.customerId, table.occurredAt),
    index('loyalty_ledger_entry_branch_idx').on(table.branchId, table.occurredAt),
    uniqueIndex('loyalty_ledger_entry_idempotency_unique').on(table.branchId, table.idempotencyKey),
  ],
)

/**
 * Point lot created by every EARN (and positive ADJUST). remaining_points is a
 * projection of the append-only consumption rows; lots never go negative.
 */
export const loyaltyLot = pgTable(
  'loyalty_lot',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => loyaltyAccount.id, { onDelete: 'restrict' }),
    earnEntryId: uuid('earn_entry_id')
      .notNull()
      .unique()
      .references(() => loyaltyLedgerEntry.id, { onDelete: 'restrict' }),
    points: integer('points').notNull(),
    remainingPoints: integer('remaining_points').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('loyalty_lot_account_expiry_idx').on(table.accountId, table.expiresAt),
    index('loyalty_lot_expiry_idx').on(table.expiresAt).where(sql`${table.remainingPoints} > 0`),
  ],
)

/** Append-only per-lot consumption rows (redemption, clawback, expiry). */
export const loyaltyLotConsumption = pgTable(
  'loyalty_lot_consumption',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    lotId: uuid('lot_id')
      .notNull()
      .references(() => loyaltyLot.id, { onDelete: 'restrict' }),
    entryId: uuid('entry_id')
      .notNull()
      .references(() => loyaltyLedgerEntry.id, { onDelete: 'restrict' }),
    points: integer('points').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('loyalty_lot_consumption_lot_entry_unique').on(table.lotId, table.entryId),
    index('loyalty_lot_consumption_entry_idx').on(table.entryId),
  ],
)
