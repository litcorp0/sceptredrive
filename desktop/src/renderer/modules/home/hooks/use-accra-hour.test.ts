import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  currentAccraHour,
  HOUR_GUARD_MS,
  msUntilNextAccraHour,
  scheduleAccraHourFlip,
} from './use-accra-hour'

/**
 * The current-hour bar (P10-D14).
 *
 * "Where are we right now" is only true if the highlighted bar follows the clock. These cases
 * pin the boundary maths and the re-arm, not the React wrapper — the suite runs in the node
 * environment with no DOM.
 */

const MINUTE = 60_000
const HOUR = 3_600_000

describe('currentAccraHour', () => {
  it('reads the UTC hour, which is the Accra hour', () => {
    expect(currentAccraHour(Date.parse('2026-10-25T09:59:59.999Z'))).toBe(9)
    expect(currentAccraHour(Date.parse('2026-10-25T23:00:00.000Z'))).toBe(23)
    expect(currentAccraHour(Date.parse('2026-10-25T00:00:00.000Z'))).toBe(0)
  })
})

describe('msUntilNextAccraHour', () => {
  it('is the rest of the hour plus the guard', () => {
    // 09:20 → 40 minutes left.
    expect(msUntilNextAccraHour(Date.parse('2026-10-25T09:20:00.000Z'))).toBe(
      40 * MINUTE + HOUR_GUARD_MS,
    )
  })

  it('is a full hour, not just the guard, at an exact boundary', () => {
    expect(msUntilNextAccraHour(Date.parse('2026-10-25T09:00:00.000Z'))).toBe(HOUR + HOUR_GUARD_MS)
  })
})

describe('scheduleAccraHourFlip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('flips once at the next hour, and not a tick before it', () => {
    vi.setSystemTime(new Date('2026-10-25T09:59:00.000Z'))
    const hours: number[] = []
    const dispose = scheduleAccraHourFlip(() => hours.push(currentAccraHour()))

    vi.advanceTimersByTime(MINUTE + HOUR_GUARD_MS - 1)
    expect(hours).toEqual([])

    vi.advanceTimersByTime(1)
    expect(hours).toEqual([10])

    dispose()
  })

  it('re-arms for the following hour and stops once disposed', () => {
    vi.setSystemTime(new Date('2026-10-25T09:59:00.000Z'))
    const hours: number[] = []
    const dispose = scheduleAccraHourFlip(() => hours.push(currentAccraHour()))

    vi.advanceTimersByTime(MINUTE + HOUR_GUARD_MS)
    vi.advanceTimersByTime(HOUR)
    expect(hours).toEqual([10, 11])

    dispose()
    vi.advanceTimersByTime(HOUR * 3)
    expect(hours).toEqual([10, 11])
  })
})
