import { describe, expect, it } from 'vitest'
import { lockoutMessage } from './lockout-copy'

/**
 * The lockout sentence (Plan 08 Task 2).
 *
 * A cashier locked out for five minutes needs to know that waiting is enough; one whose lock
 * has already expired needs to be told a manager is the way back, not to keep staring at the
 * clock. The old copy named the attempt count and neither.
 */
describe('lockoutMessage', () => {
  const now = Date.parse('2026-10-25T10:00:00.000Z')

  it('names the remaining minutes when the lock is still running', () => {
    expect(lockoutMessage('2026-10-25T10:05:00.000Z', now)).toBe(
      'Too many wrong PINs. Try again in 5 minutes, or ask a manager to unlock this terminal.',
    )
  })

  it('says one minute, not one minutes', () => {
    expect(lockoutMessage('2026-10-25T10:01:00.000Z', now)).toBe(
      'Too many wrong PINs. Try again in 1 minute, or ask a manager to unlock this terminal.',
    )
  })

  it('rounds a partly elapsed minute up, so a cashier never waits for a time that has passed', () => {
    expect(lockoutMessage('2026-10-25T10:02:30.000Z', now)).toBe(
      'Too many wrong PINs. Try again in 3 minutes, or ask a manager to unlock this terminal.',
    )
  })

  it('drops the wait once the lock has expired', () => {
    expect(lockoutMessage('2026-10-25T09:59:00.000Z', now)).toBe(
      'Too many wrong PINs. A manager can unlock this terminal.',
    )
  })

  it('drops the wait when the binding carries no deadline', () => {
    expect(lockoutMessage(null, now)).toBe(
      'Too many wrong PINs. A manager can unlock this terminal.',
    )
    expect(lockoutMessage('not-a-date', now)).toBe(
      'Too many wrong PINs. A manager can unlock this terminal.',
    )
  })
})
