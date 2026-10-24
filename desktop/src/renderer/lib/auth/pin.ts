import { PIN_MAX_LENGTH, PIN_MIN_LENGTH, PIN_PROBLEM_MESSAGES, pinProblem } from '@sceptre/shared'
import { desktopApi, isDesktopAvailable } from '../desktop-api'

/**
 * Offline PIN policy for the terminal.
 *
 * The device never stores the PIN: it stores `Argon2id(PIN, deviceSalt)` and the
 * salt in the encrypted local database. Verification happens in the main
 * process via IPC. Lockout is pure arithmetic so it is unit-testable without a
 * database.
 */

export { PIN_MAX_LENGTH, PIN_MIN_LENGTH, PIN_PROBLEM_MESSAGES, pinProblem }

export const PIN_SALT_BYTES = 16

export interface LockoutPolicy {
  maxAttempts: number
  lockMinutes: number
}

/** Matches the `pos.pinMaxAttempts` / `pos.pinLockMinutes` defaults (D24). */
export const DEFAULT_LOCKOUT_POLICY: LockoutPolicy = { maxAttempts: 5, lockMinutes: 5 }

export interface LockoutState {
  failedAttempts: number
  lockedUntil: string | null
}

/** 16 random bytes, base64. Used as the Argon2 pepper, stored beside the verifier. */
export function createPinSalt(): string {
  const bytes = new Uint8Array(PIN_SALT_BYTES)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  if (!isDesktopAvailable()) {
    throw new Error('The desktop bridge is required to verify a PIN')
  }
  return desktopApi.hashPin(pin, salt)
}

export async function verifyPinHash(verifier: string, pin: string, salt: string): Promise<boolean> {
  if (!isDesktopAvailable()) {
    throw new Error('The desktop bridge is required to verify a PIN')
  }
  return desktopApi.verifyPin(verifier, pin, salt)
}

/** A lock whose time has passed is no longer a lock. */
export function normalizeLockout(state: LockoutState, now = Date.now()): LockoutState {
  if (state.lockedUntil && Date.parse(state.lockedUntil) <= now) {
    return { failedAttempts: 0, lockedUntil: null }
  }
  return state
}

export function isLocked(state: LockoutState, now = Date.now()): boolean {
  return Boolean(state.lockedUntil && Date.parse(state.lockedUntil) > now)
}

/** Counts a failure; the attempt that reaches the maximum starts the lock. */
export function afterFailure(
  state: LockoutState,
  policy: LockoutPolicy,
  now = Date.now(),
): LockoutState {
  const attempts = normalizeLockout(state, now).failedAttempts + 1
  if (attempts >= policy.maxAttempts) {
    return {
      failedAttempts: 0,
      lockedUntil: new Date(now + policy.lockMinutes * 60_000).toISOString(),
    }
  }
  return { failedAttempts: attempts, lockedUntil: null }
}

export function afterSuccess(): LockoutState {
  return { failedAttempts: 0, lockedUntil: null }
}

export function remainingAttempts(state: LockoutState, policy: LockoutPolicy): number {
  return Math.max(0, policy.maxAttempts - normalizeLockout(state).failedAttempts)
}
