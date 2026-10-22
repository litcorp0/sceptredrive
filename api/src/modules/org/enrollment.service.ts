import { createHmac, randomBytes, randomInt } from 'node:crypto'
import { db } from '@gikautos/db'
import { env } from '../../config/env.ts'
import { AppError, ConflictError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { findBranchById } from './branches.repository.ts'
import {
  expireOutstandingEnrollments,
  findEnrollmentByCodeHashForUpdate,
  insertEnrollmentRow,
  markEnrollmentUsed,
} from './enrollment.repository.ts'
import type { CreatedEnrollment, RedeemedDevice } from './enrollment.types.ts'
import { findTerminalById, insertDevice } from './terminals.repository.ts'
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

/** 32 random bytes, URL-safe: 256 bits of device credential. */
export function generateDeviceToken(): string {
  return randomBytes(32).toString('base64url')
}

/**
 * Device tokens are stored keyed-hashed, exactly like enrollment codes: a
 * database leak alone cannot produce a usable terminal credential.
 */
export function hashDeviceToken(token: string): string {
  return createHmac('sha256', env.BETTER_AUTH_SECRET).update(token).digest('hex')
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
 * Validates a one-time enrollment code, consumes it, and issues the terminal's
 * device token (returned exactly once; only its keyed hash is stored).
 *
 * The row is locked for the transaction so a stolen code cannot be redeemed
 * twice by racing clients.
 */
export async function redeemEnrollment(
  code: string,
  fingerprint = 'unknown',
): Promise<RedeemedDevice> {
  const codeHash = hashEnrollmentCode(code)

  return db.transaction(async (tx) => {
    const enrollment = await findEnrollmentByCodeHashForUpdate(codeHash, tx)
    if (!enrollment) {
      throw new AppError(400, 'ENROLLMENT_INVALID', 'Enrollment code is invalid or expired')
    }
    if (enrollment.usedAt) {
      throw new AppError(400, 'ENROLLMENT_INVALID', 'Enrollment code has already been used')
    }
    if (enrollment.expiresAt.getTime() <= Date.now()) {
      throw new AppError(400, 'ENROLLMENT_INVALID', 'Enrollment code is invalid or expired')
    }

    const terminal = await findTerminalById(enrollment.terminalId, tx)
    if (!terminal) {
      throw new AppError(400, 'ENROLLMENT_INVALID', 'Enrollment code is invalid or expired')
    }
    if (!terminal.isActive) {
      throw new AppError(409, 'TERMINAL_INACTIVE', 'Terminal is not active')
    }

    const branch = await findBranchById(terminal.branchId, tx)
    if (!branch) {
      throw new AppError(400, 'ENROLLMENT_INVALID', 'Enrollment code is invalid or expired')
    }
    if (branch.type === 'WAREHOUSE') {
      throw new AppError(409, 'BRANCH_NOT_RETAIL', 'A warehouse branch cannot host a POS terminal')
    }
    if (!branch.isActive) {
      throw new AppError(409, 'BRANCH_INACTIVE', 'Branch is not active')
    }

    const deviceToken = generateDeviceToken()
    const now = new Date()

    await markEnrollmentUsed(enrollment.id, now, tx)

    const deviceRow = await insertDevice(
      {
        terminalId: terminal.id,
        fingerprint,
        tokenHash: hashDeviceToken(deviceToken),
        status: 'ACTIVE',
        enrolledAt: now,
      },
      tx,
    )
    if (!deviceRow) {
      throw new AppError(500, 'DEVICE_ENROLLMENT_FAILED', 'Could not enrol this terminal')
    }

    await writeAudit(
      {
        action: 'terminal.enrollment.redeemed',
        entity: 'terminal',
        entityId: terminal.id,
        after: { enrollmentId: enrollment.id, deviceId: deviceRow.id },
        branchId: branch.id,
        terminalId: terminal.id,
      },
      tx,
    )

    // Never log or audit the token itself.
    await writeAudit(
      {
        action: 'device.token.issued',
        entity: 'device',
        entityId: deviceRow.id,
        after: { terminalId: terminal.id, fingerprint },
        branchId: branch.id,
        terminalId: terminal.id,
      },
      tx,
    )

    return {
      deviceId: deviceRow.id,
      deviceToken,
      terminalId: terminal.id,
      terminalCode: terminal.code,
      branchId: branch.id,
      branchName: branch.name,
      branchCode: branch.code,
    }
  })
}
