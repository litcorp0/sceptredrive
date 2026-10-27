import { desc, sql } from 'drizzle-orm'
import {
  check,
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
import { terminal } from '../org/terminals.schema.ts'
import { refund, sale } from '../pos/pos.schema.ts'

/**
 * What the document is: a sale's invoice or a refund's credit note (P14-D34).
 */
export const evatDocumentKindEnum = pgEnum('evat_document_kind', ['INVOICE', 'REFUND'])

/**
 * `WAITING_FOR_INVOICE` is a refund whose sale is not certified yet (P14-D37),
 * `RETRY` is a coded refusal with a `next_attempt_at`, and `ATTENTION` is a
 * refusal somebody has to look at.
 */
export const evatSubmissionStatusEnum = pgEnum('evat_submission_status', [
  'QUEUED',
  'WAITING_FOR_INVOICE',
  'SUBMITTING',
  'CERTIFIED',
  'RETRY',
  'ATTENTION',
])

/**
 * One row per document, and the certificate it received (P14-D34/P14-D35).
 *
 * Certification never touches `sale` or `refund`: after a submission both are
 * byte-identical to what the till wrote, and every GRA field — GRA's `num`,
 * `ysdcid`, `ysdcrecnum`, `ysdcregsig`, `ysdcintdata`, `ysdcmrc`, `ysdctime` and
 * `qr_code` — is stored here under our names. `qr_payload` is GRA's bytes as
 * returned, never a URL we composed.
 *
 * `sale_id` and `refund_id` are exclusive by CHECK and unique by partial index:
 * a sale has one certificate and a refund has one, enforced by the database
 * rather than by hoping.
 */
export const evatSubmission = pgTable(
  'evat_submission',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: evatDocumentKindEnum('kind').notNull(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    /** A refund always has a terminal; a console-originated row still names the one that sold. */
    terminalId: uuid('terminal_id')
      .notNull()
      .references(() => terminal.id, { onDelete: 'restrict' }),
    saleId: uuid('sale_id').references(() => sale.id, { onDelete: 'restrict' }),
    refundId: uuid('refund_id').references(() => refund.id, { onDelete: 'restrict' }),
    status: evatSubmissionStatusEnum('status').notNull().default('QUEUED'),
    attempts: integer('attempts').notNull().default(0),
    /** Set on `RETRY` only; the ladder's next rung (P14-D36). */
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    /**
     * `occurred_at + 24h`, written once at enqueue so the deadline is a column and
     * not a join. `DUE` is never recomputed from a different clock (P14-D36).
     */
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    provider: text('provider').notNull(),
    providerInvoiceNumber: text('provider_invoice_number'),
    sdcId: text('sdc_id'),
    serial: text('serial'),
    signature: text('signature'),
    internalData: text('internal_data'),
    machineCode: text('machine_code'),
    stampedAt: timestamp('stamped_at', { withTimezone: true }),
    qrPayload: text('qr_payload'),
    lastErrorCode: text('last_error_code'),
    lastErrorMessage: text('last_error_message'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    certifiedAt: timestamp('certified_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      'evat_submission_document_xor',
      sql`((${table.kind} = 'INVOICE' and ${table.saleId} is not null and ${table.refundId} is null) or (${table.kind} = 'REFUND' and ${table.refundId} is not null and ${table.saleId} is null))`,
    ),
    uniqueIndex('evat_submission_sale_unique')
      .on(table.saleId)
      .where(sql`${table.saleId} is not null`),
    uniqueIndex('evat_submission_refund_unique')
      .on(table.refundId)
      .where(sql`${table.refundId} is not null`),
    index('evat_submission_queue_idx').on(table.status, table.nextAttemptAt),
    index('evat_submission_branch_created_idx').on(table.branchId, desc(table.createdAt)),
  ],
)
