import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { branch } from '../org/branches.schema.ts'

/**
 * Branch-and-month document counters (Phase 11, P11-D15).
 *
 * The existing `setting` sequences are one static prefix plus one padded
 * counter in a single row: they cannot express `PO-ACC-202610-0001`, which is
 * per branch and resets each month. Rather than invent dynamic setting keys
 * that `SETTING_DEFINITIONS` cannot validate, the counter gets a table of its
 * own with the uniqueness the problem actually has.
 *
 * `branch_id` is a real foreign key here (unlike `setting.branch_id`): a
 * sequence without a branch is meaningless.
 */
export const documentSequence = pgTable(
  'document_sequence',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    branchId: uuid('branch_id')
      .notNull()
      .references(() => branch.id, { onDelete: 'restrict' }),
    /** `purchase_order`, `supplier_return`, `supplier_credit_note`, … */
    kind: text('kind').notNull(),
    /** `YYYY-MM` in Africa/Accra (UTC+0, so the UTC month is the Accra month). */
    period: text('period').notNull(),
    /** The last serial issued. Gaps are acceptable; duplicates never are. */
    value: integer('value').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    uniqueIndex('document_sequence_branch_kind_period_unique').on(
      table.branchId,
      table.kind,
      table.period,
    ),
  ],
)
