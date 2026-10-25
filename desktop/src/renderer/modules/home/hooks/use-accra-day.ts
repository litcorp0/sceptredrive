import { accraIsoDay, msUntilNextAccraDay } from '@sceptre/shared'
import { useEffect, useState } from 'react'

/**
 * The Accra day the home screen reports, kept true across midnight (P10-D13).
 *
 * A till is left open overnight. Without a boundary timer, the first cashier of the next
 * morning reads yesterday's take under a heading that says "today" — on a screen whose only
 * claim is that it is this terminal's day.
 *
 * Africa/Accra is UTC+0 all year with no DST, so the boundary is an exact UTC midnight and
 * no timezone library is involved. `msUntilNextAccraDay` already returns a value in
 * `(0, 86_400_000]`, so the timer cannot re-arm at zero and spin.
 */

/**
 * The guard added to every re-arm, in milliseconds.
 *
 * A suspend/resume or a clock adjustment can land a timer a little early; firing 1 s before
 * midnight would compute the *old* day and then wait another whole day to correct itself.
 * Two seconds of slack is invisible to a cashier and takes that failure off the table.
 */
export const ACCRA_DAY_GUARD_MS = 2_000

/**
 * Re-arm a timeout to the next Accra midnight until disposed.
 *
 * Kept out of the hook so it can be tested under fake timers without a React renderer
 * (this suite runs in the node environment and carries no DOM library). `onFlip` runs once
 * per boundary, and the returned function clears the pending timer.
 */
export function scheduleAccraDayFlip(onFlip: () => void, now: () => number = Date.now): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const arm = (): void => {
    if (disposed) return
    timer = setTimeout(() => {
      if (disposed) return
      onFlip()
      arm()
    }, msUntilNextAccraDay(now()) + ACCRA_DAY_GUARD_MS)
  }

  arm()

  return () => {
    disposed = true
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
}

/**
 * `2026-10-25` — today in Accra, re-rendering at the next Accra midnight.
 *
 * The state is seeded from the clock on mount, and every query keyed on the returned string
 * re-runs when it changes, so the whole home screen rolls over together.
 */
export function useAccraDay(): string {
  const [day, setDay] = useState(() => accraIsoDay(Date.now()))

  useEffect(() => scheduleAccraDayFlip(() => setDay(accraIsoDay(Date.now()))), [])

  return day
}
