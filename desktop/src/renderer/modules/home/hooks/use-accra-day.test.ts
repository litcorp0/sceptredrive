import { accraIsoDay } from '@sceptre/shared'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ACCRA_DAY_GUARD_MS, scheduleAccraDayFlip } from './use-accra-day'

/**
 * The midnight boundary (P10-D13).
 *
 * A till is left open overnight, so "today" has to roll over by itself. The hook is a thin
 * wrapper around this scheduler; testing the scheduler keeps the case honest without a DOM
 * renderer (the desktop suite runs in the node environment and carries no DOM library).
 */

const MINUTE = 60_000
const DAY = 86_400_000

describe('scheduleAccraDayFlip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flips once at the next Accra midnight, and not a tick before it', () => {
    vi.setSystemTime(new Date('2026-10-25T23:59:00.000Z'))
    const days: string[] = []
    const dispose = scheduleAccraDayFlip(() => days.push(accraIsoDay(Date.now())))

    // 62 000 = 60 000 ms to midnight plus the 2 s guard.
    vi.advanceTimersByTime(MINUTE + ACCRA_DAY_GUARD_MS - 1)
    expect(days).toEqual([])

    vi.advanceTimersByTime(1)
    expect(days).toEqual(['2026-10-26'])

    dispose()
  })

  it('re-arms for the following midnight', () => {
    vi.setSystemTime(new Date('2026-10-25T23:59:00.000Z'))
    const days: string[] = []
    const dispose = scheduleAccraDayFlip(() => days.push(accraIsoDay(Date.now())))

    vi.advanceTimersByTime(MINUTE + ACCRA_DAY_GUARD_MS)
    expect(days).toEqual(['2026-10-26'])

    vi.advanceTimersByTime(DAY)
    expect(days).toEqual(['2026-10-26', '2026-10-27'])

    dispose()
  })

  it('does not spin when armed at exactly midnight', () => {
    vi.setSystemTime(new Date('2026-10-26T00:00:00.000Z'))
    const days: string[] = []
    const dispose = scheduleAccraDayFlip(() => days.push(accraIsoDay(Date.now())))

    // `msUntilNextAccraDay` returns a full day at midnight rather than zero, so the first
    // flip is a day away and not a zero-delay timeout that burns the event loop.
    vi.advanceTimersByTime(ACCRA_DAY_GUARD_MS - 1)
    expect(days).toEqual([])

    vi.advanceTimersByTime(DAY + ACCRA_DAY_GUARD_MS)
    expect(days).toEqual(['2026-10-27'])

    dispose()
  })

  it('stops flipping once disposed', () => {
    vi.setSystemTime(new Date('2026-10-25T12:00:00.000Z'))
    const days: string[] = []
    const dispose = scheduleAccraDayFlip(() => days.push(accraIsoDay(Date.now())))

    vi.advanceTimersByTime(DAY)
    expect(days).toHaveLength(1)

    dispose()
    vi.advanceTimersByTime(DAY * 3)
    expect(days).toHaveLength(1)
  })
})
