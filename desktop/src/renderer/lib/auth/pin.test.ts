import { describe, expect, it } from 'vitest'
import {
  afterFailure,
  afterSuccess,
  createPinSalt,
  DEFAULT_LOCKOUT_POLICY,
  isLocked,
  type LockoutState,
  normalizeLockout,
  PIN_SALT_BYTES,
  remainingAttempts,
} from './pin'

const NOW = Date.parse('2026-10-22T10:00:00Z')
const POLICY = { maxAttempts: 5, lockMinutes: 5 }

describe('offline PIN lockout', () => {
  it('counts failures and locks on the attempt that reaches the maximum', () => {
    let state: LockoutState = { failedAttempts: 0, lockedUntil: null }
    for (let attempt = 1; attempt < POLICY.maxAttempts; attempt += 1) {
      state = afterFailure(state, POLICY, NOW)
      expect(state.lockedUntil).toBeNull()
      expect(state.failedAttempts).toBe(attempt)
    }

    state = afterFailure(state, POLICY, NOW)
    expect(state.failedAttempts).toBe(0)
    expect(state.lockedUntil).toBe(new Date(NOW + 5 * 60_000).toISOString())
    expect(isLocked(state, NOW)).toBe(true)
    expect(isLocked(state, NOW + 5 * 60_000)).toBe(false)
  })

  it('treats an expired lock as unlocked and resets its counter', () => {
    const expired = { failedAttempts: 0, lockedUntil: new Date(NOW - 1).toISOString() }
    expect(isLocked(expired, NOW)).toBe(false)
    expect(normalizeLockout(expired, NOW)).toEqual({ failedAttempts: 0, lockedUntil: null })
    expect(afterFailure(expired, POLICY, NOW).failedAttempts).toBe(1)
  })

  it('resets after a successful PIN and reports attempts left', () => {
    expect(afterSuccess()).toEqual({ failedAttempts: 0, lockedUntil: null })

    const twoFailures = { failedAttempts: 2, lockedUntil: null }
    expect(remainingAttempts(twoFailures, POLICY)).toBe(3)
    expect(remainingAttempts({ failedAttempts: 5, lockedUntil: null }, POLICY)).toBe(0)
  })

  it('uses the documented default policy before the first config sync', () => {
    expect(DEFAULT_LOCKOUT_POLICY).toEqual({ maxAttempts: 5, lockMinutes: 5 })
  })

  it('creates a 16-byte base64 device salt', () => {
    const salt = createPinSalt()
    expect(Buffer.from(salt, 'base64')).toHaveLength(PIN_SALT_BYTES)
    expect(createPinSalt()).not.toBe(salt)
  })
})
