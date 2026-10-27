import type { PowerSyncDatabase } from '@powersync/web'
import { getBinding } from '@/lib/auth/bindings'
import { requireStaffSession, type StaffSession } from '@/lib/auth/staff-session'
import { countHeldCarts, listHeldCarts, voidHeldCart } from '@/lib/hold/hold-service'
import { type PosIdentity, readPosIdentity } from '@/lib/pos-config'
import type { LocalShiftReport } from '@/lib/shift/shift-report'
import { findOpenShift, type LocalShift } from '@/lib/shift/shift-repository'
import { type CloseShiftResult, type CloseStaffProof, closeShift } from '@/lib/shift/shift-service'

/**
 * The close, with its holds step (P13-D30, P13-D41).
 *
 * `closeShift` owns the drawer arithmetic, the `SHIFT_CLOSE` row, and the Z
 * snapshot — all in one transaction (P13-D32). This module is the counter-side
 * orchestration around it: ask about the holds, park or void them, hand the
 * close the closer's proof, and give the screen the report to print.
 *
 * There is deliberately no report write and no retry here. A close either
 * commits with its snapshot or does not happen at all.
 */

export type HoldsDecision = 'KEEP' | 'VOID_ALL'

export type CloseShiftErrorCode =
  | 'HOLDS_UNDECIDED'
  | 'NO_IDENTITY'
  | 'NO_OPEN_SHIFT'
  | 'NOT_SIGNED_IN'

export class CloseShiftError extends Error {
  readonly code: CloseShiftErrorCode

  constructor(code: CloseShiftErrorCode, message: string) {
    super(message)
    this.name = 'CloseShiftError'
    this.code = code
  }
}

export interface CloseShiftWithReportInput {
  countedCashMinor: number
  note?: string | undefined
  /**
   * Required only when the terminal still holds carts. The dialog collects it
   * before the count step, so a close can never be the thing that deletes a hold
   * nobody was asked about.
   */
  holdsDecision?: HoldsDecision | undefined
}

export interface CloseShiftWithReportResult {
  shift: LocalShift
  expectedCashMinor: number
  varianceMinor: number
  /** The snapshot the close wrote, ready to print (P13-D34). */
  report: LocalShiftReport
  /** Holds voided by this close; zero for `KEEP` and for an empty tray. */
  voidedHolds: number
}

/**
 * The closer's proof, or null when the binding cannot be read.
 *
 * Null is not a refusal: the server treats `closedBy` as optional and falls back
 * to the shift's cashier. A close must not be blocked by a binding row the
 * terminal can no longer find, because the drawer is still in front of the
 * cashier and the money still has to be counted.
 */
async function closerProof(
  db: PowerSyncDatabase,
  session: StaffSession,
): Promise<CloseStaffProof | null> {
  const binding = await getBinding(db, session.bindingId)
  if (!binding || !binding.isActive) return null
  return {
    userId: session.userId,
    staffId: session.staffId,
    bindingId: binding.bindingId,
    bindingToken: binding.bindingToken,
    pinVersion: binding.pinVersion,
  }
}

export async function closeShiftWithReport(
  db: PowerSyncDatabase,
  input: CloseShiftWithReportInput,
  options: { now?: Date } = {},
): Promise<CloseShiftWithReportResult> {
  let session: StaffSession
  try {
    session = requireStaffSession()
  } catch {
    throw new CloseShiftError('NOT_SIGNED_IN', 'Sign in with a PIN before closing the shift')
  }

  const identity: PosIdentity | null = await readPosIdentity(db)
  if (!identity) {
    throw new CloseShiftError('NO_IDENTITY', 'This terminal is not configured yet')
  }

  const open = await findOpenShift(db, identity.terminalId)
  if (!open) throw new CloseShiftError('NO_OPEN_SHIFT', 'There is no open shift to close')

  const held = await countHeldCarts(db)
  if (held > 0 && input.holdsDecision !== 'KEEP' && input.holdsDecision !== 'VOID_ALL') {
    throw new CloseShiftError(
      'HOLDS_UNDECIDED',
      held === 1
        ? 'One cart is still held. Keep it for the next shift, or void it.'
        : `${held} carts are still held. Keep them for the next shift, or void them.`,
    )
  }

  let voidedHolds = 0
  if (held > 0 && input.holdsDecision === 'VOID_ALL') {
    const holds = await listHeldCarts(db)
    for (const hold of holds) {
      // Before the drawer is counted and before the shift row closes: the void
      // belongs to the shift that is still open (P13-D30), and a hold that
      // cannot be recorded aborts the close rather than disappearing.
      await voidHeldCart(db, hold.id, 'CUSTOMER_LEFT', `Voided at shift close: ${hold.label}`)
      voidedHolds += 1
    }
  }

  const proof = await closerProof(db, session)
  const closed: CloseShiftResult = await closeShift(db, {
    countedCashMinor: input.countedCashMinor,
    ...(input.note ? { note: input.note } : {}),
    ...(proof ? { closedBy: proof } : {}),
    ...(options.now ? { now: options.now } : {}),
  })

  return {
    shift: closed.shift,
    expectedCashMinor: closed.expectedCashMinor,
    varianceMinor: closed.varianceMinor,
    report: closed.report,
    voidedHolds,
  }
}
