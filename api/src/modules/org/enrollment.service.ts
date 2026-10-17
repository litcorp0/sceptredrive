import { createHmac, randomInt } from 'node:crypto'
import { db } from '@gikautos/db'
import { env } from '../../config/env.ts'
import { AppError, ConflictError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import {
  expireOutstandingEnrollments,
  findEnrollmentByCodeHash,
  insertEnrollmentRow,
  markEnrollmentUsed,
} from './enrollment.repository.ts'
import type { CreatedEnrollment, RedeemedEnrollment } from './enrollment.types.ts'
import * as terminalsService from './terminals.service.ts'

/** Human-typable alphabet without ambiguous characters (no 0/O, 1/I/L). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8
export const ENROLLMENT_TTL_MS = 15 * 60 * 1000

export function generateEnrollmentCode(): string {
  let code = ''
  for (let index = 0; index < CODE_LENGTH; index += 1) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]
  }
  return code
}

export function normalizeEnrollmentCode(code: string): string {
  return code.toUpperCase().replace(/[\s-]/g, '')
}

/**
 * Enrollment codes are stored as keyed hashes: a database leak alone cannot
 * brute-force the recovered code without the auth secret.
 */
export function hashEnrollmentCode(code: string): string {
  return createHmac('sha256', env.BETTER_AUTH_SECRET)
    .update(normalizeEnrollmentCode(code))
    .digest('hex')
}

export async function createEnrollment(
  user: SessionUser,
  actor: AuditActor,
  terminalId: string,
): Promise<CreatedEnrollment> {
  const terminal = await terminalsService.getTerminal(user, terminalId)
  if (!terminal.isActive) throw new ConflictError('Terminal is not active')

  return db.transaction(async (tx) => {
    await expireOutstandingEnrollments(terminal.id, tx)

    const code = generateEnrollmentCode()
    const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS)
    await insertEnrollmentRow(
      {
        terminalId: terminal.id,
        codeHash: hashEnrollmentCode(code),
        expiresAt,
        createdBy: actor.actorId,
      },
      tx,
    )

    await writeAudit(
      {
        ...actor,
        action: 'terminal.enrollment.created',
        entity: 'terminal',
        entityId: terminal.id,
        after: { expiresAt: expiresAt.toISOString() },
        branchId: terminal.branchId,
        terminalId: terminal.id,
      },
      tx,
    )

    return { code, expiresAt }
  })
}

/**
 * Validates a one-time enrollment code and consumes it. Phase 1 stops short
 * of issuing device tokens (PowerSync arrives in Phase 6); the route turns
 * this into an explicit 501 so the POS contract is already stable.
 */
export async function redeemEnrollment(code: string): Promise<RedeemedEnrollment> {
  const codeHash = hashEnrollmentCode(code)

  return db.transaction(async (tx) => {
    const enrollment = await findEnrollmentByCodeHash(codeHash, tx)
    if (!enrollment) {
      throw new AppError(400, 'ENROLLMENT_INVALID', 'Enrollment code is invalid or expired')
    }
    if (enrollment.usedAt) {
      throw new AppError(400, 'ENROLLMENT_INVALID', 'Enrollment code has already been used')
    }
    if (enrollment.expiresAt.getTime() <= Date.now()) {
      throw new AppError(400, 'ENROLLMENT_INVALID', 'Enrollment code is invalid or expired')
    }

    await markEnrollmentUsed(enrollment.id, new Date(), tx)

    await writeAudit(
      {
        action: 'terminal.enrollment.redeemed',
        entity: 'terminal',
        entityId: enrollment.terminalId,
        after: { enrollmentId: enrollment.id },
        terminalId: enrollment.terminalId,
      },
      tx,
    )

    return { enrollmentId: enrollment.id, terminalId: enrollment.terminalId }
  })
}
