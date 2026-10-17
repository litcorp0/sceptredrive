import { createHmac, randomInt } from 'node:crypto'
import { db } from '@gikautos/db'
import { terminal, terminalEnrollment } from '@gikautos/db/schema'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { assertBranchAccess } from '../../auth/scope.ts'
import { env } from '../../config/env.ts'
import { AppError, ConflictError, NotFoundError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { type AuditActor, writeAudit } from '../platform/audit.service.ts'

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

export interface CreatedEnrollment {
  code: string
  expiresAt: Date
}

export async function createEnrollment(
  user: SessionUser,
  actor: AuditActor,
  terminalId: string,
): Promise<CreatedEnrollment> {
  return db.transaction(async (tx) => {
    const terminalRows = await tx
      .select()
      .from(terminal)
      .where(eq(terminal.id, terminalId))
      .limit(1)
    const parent = terminalRows[0]
    if (!parent) throw new NotFoundError('Terminal not found')
    assertBranchAccess(user, parent.branchId)
    if (!parent.isActive) throw new ConflictError('Terminal is not active')

    // Only one live code per terminal: expire any outstanding unused codes.
    await tx
      .update(terminalEnrollment)
      .set({ expiresAt: new Date() })
      .where(
        and(
          eq(terminalEnrollment.terminalId, terminalId),
          isNull(terminalEnrollment.usedAt),
          sql`${terminalEnrollment.expiresAt} > now()`,
        ),
      )

    const code = generateEnrollmentCode()
    const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MS)
    await tx.insert(terminalEnrollment).values({
      terminalId,
      codeHash: hashEnrollmentCode(code),
      expiresAt,
      createdBy: actor.actorId,
    })

    await writeAudit(
      {
        ...actor,
        action: 'terminal.enrollment.created',
        entity: 'terminal',
        entityId: terminalId,
        after: { expiresAt: expiresAt.toISOString() },
        branchId: parent.branchId,
        terminalId,
      },
      tx,
    )

    return { code, expiresAt }
  })
}

export interface RedeemedEnrollment {
  enrollmentId: string
  terminalId: string
}

/**
 * Validates a one-time enrollment code and consumes it. Phase 1 stops short
 * of issuing device tokens (PowerSync arrives in Phase 6); the route turns
 * this into an explicit 501 so the POS contract is already stable.
 */
export async function redeemEnrollment(code: string): Promise<RedeemedEnrollment> {
  const codeHash = hashEnrollmentCode(code)

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(terminalEnrollment)
      .where(eq(terminalEnrollment.codeHash, codeHash))
      .limit(1)
    const enrollment = rows[0]
    if (!enrollment) {
      throw new AppError(400, 'ENROLLMENT_INVALID', 'Enrollment code is invalid or expired')
    }
    if (enrollment.usedAt) {
      throw new AppError(400, 'ENROLLMENT_INVALID', 'Enrollment code has already been used')
    }
    if (enrollment.expiresAt.getTime() <= Date.now()) {
      throw new AppError(400, 'ENROLLMENT_INVALID', 'Enrollment code is invalid or expired')
    }

    await tx
      .update(terminalEnrollment)
      .set({ usedAt: new Date() })
      .where(eq(terminalEnrollment.id, enrollment.id))

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
