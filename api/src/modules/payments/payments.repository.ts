import { type DbExecutor, db } from '@sceptre/db'
import { and, asc, eq, lt, sql } from 'drizzle-orm'
import { terminal } from '../org/terminals.schema.ts'
import { payment, paymentEvent } from './payments.schema.ts'

/**
 * Payment data access only. The state machine lives in `payments.service.ts`;
 * these helpers never decide a transition.
 */

export type PaymentRow = typeof payment.$inferSelect
export type PaymentEventRow = typeof paymentEvent.$inferSelect
export type PaymentStatus = PaymentRow['status']

export interface PaymentPatch {
  status?: PaymentStatus
  channel?: string | null
  displayText?: string | null
  authorizationUrl?: string | null
  accountNumber?: string | null
  accountName?: string | null
  accountBank?: string | null
  expiresAt?: Date | null
  paidAt?: Date | null
  providerTransactionId?: string | null
  failedCode?: string | null
  failedMessage?: string | null
  orphaned?: boolean
  lastVerifiedAt?: Date | null
}

export async function findByClientId(
  terminalId: string,
  clientPaymentId: string,
  executor: DbExecutor = db,
): Promise<PaymentRow | null> {
  const rows = await executor
    .select()
    .from(payment)
    .where(and(eq(payment.terminalId, terminalId), eq(payment.clientPaymentId, clientPaymentId)))
    .limit(1)
  return rows[0] ?? null
}

export async function findById(id: string, executor: DbExecutor = db): Promise<PaymentRow | null> {
  const rows = await executor.select().from(payment).where(eq(payment.id, id)).limit(1)
  return rows[0] ?? null
}

export async function findByIdForUpdate(
  id: string,
  executor: DbExecutor = db,
): Promise<PaymentRow | null> {
  const rows = await executor.select().from(payment).where(eq(payment.id, id)).for('update')
  return rows[0] ?? null
}

export async function findByReference(
  reference: string,
  executor: DbExecutor = db,
): Promise<PaymentRow | null> {
  const rows = await executor
    .select()
    .from(payment)
    .where(eq(payment.providerReference, reference))
    .limit(1)
  return rows[0] ?? null
}

export async function findByReferenceForUpdate(
  reference: string,
  executor: DbExecutor = db,
): Promise<PaymentRow | null> {
  const rows = await executor
    .select()
    .from(payment)
    .where(eq(payment.providerReference, reference))
    .for('update')
  return rows[0] ?? null
}

export async function insertPayment(
  values: typeof payment.$inferInsert,
  executor: DbExecutor = db,
): Promise<PaymentRow> {
  const rows = await executor.insert(payment).values(values).returning()
  const row = rows[0]
  if (!row) throw new Error('Failed to insert the payment')
  return row
}

export async function updatePaymentStatus(
  id: string,
  patch: PaymentPatch,
  executor: DbExecutor = db,
): Promise<PaymentRow | null> {
  const rows = await executor.update(payment).set(patch).where(eq(payment.id, id)).returning()
  return rows[0] ?? null
}

export async function updateLastVerifiedAt(
  id: string,
  at: Date,
  executor: DbExecutor = db,
): Promise<void> {
  await executor.update(payment).set({ lastVerifiedAt: at }).where(eq(payment.id, id))
}

/**
 * `onConflictDoNothing` is the replay guard: the unique `(provider, body_sha256)`
 * index means a retried Paystack delivery inserts nothing and returns null.
 */
export async function insertEvent(
  values: typeof paymentEvent.$inferInsert,
  executor: DbExecutor = db,
): Promise<PaymentEventRow | null> {
  const rows = await executor
    .insert(paymentEvent)
    .values(values)
    .onConflictDoNothing({ target: [paymentEvent.provider, paymentEvent.bodySha256] })
    .returning()
  return rows[0] ?? null
}

export async function findEventByHash(
  provider: PaymentEventRow['provider'],
  bodySha256: string,
  executor: DbExecutor = db,
): Promise<PaymentEventRow | null> {
  const rows = await executor
    .select()
    .from(paymentEvent)
    .where(and(eq(paymentEvent.provider, provider), eq(paymentEvent.bodySha256, bodySha256)))
    .limit(1)
  return rows[0] ?? null
}

export async function markEventProcessed(
  id: string,
  patch: { status: 'PROCESSED' | 'IGNORED'; paymentId: string | null; processedAt: Date },
  executor: DbExecutor = db,
): Promise<void> {
  await executor.update(paymentEvent).set(patch).where(eq(paymentEvent.id, id))
}

/** Plan 07's nightly sweep: only rows older than ten minutes are candidates. */
export async function findStalePending(
  olderThan: Date,
  limit: number,
  executor: DbExecutor = db,
): Promise<PaymentRow[]> {
  return executor
    .select()
    .from(payment)
    .where(and(eq(payment.status, 'PENDING'), lt(payment.createdAt, olderThan)))
    .orderBy(asc(payment.createdAt))
    .limit(limit)
}

/** The till's late-settlement banner count, scoped to the branch that owns it. */
export async function countOrphanPaid(
  branchId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ value: sql<number>`count(*)::int` })
    .from(payment)
    .where(
      and(eq(payment.branchId, branchId), eq(payment.status, 'PAID'), eq(payment.orphaned, true)),
    )
  return rows[0]?.value ?? 0
}

/** The terminal code is part of the provider routing label (P13-D7). */
export async function selectTerminalCode(
  terminalId: string,
  executor: DbExecutor = db,
): Promise<string | null> {
  const rows = await executor
    .select({ code: terminal.code })
    .from(terminal)
    .where(eq(terminal.id, terminalId))
    .limit(1)
  return rows[0]?.code ?? null
}
