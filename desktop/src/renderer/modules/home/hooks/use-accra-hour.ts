import { useEffect, useState } from 'react'

/**
 * The Accra hour the clock is in, kept true as it changes (P10-D14).
 *
 * The hourly chart paints exactly one brand-orange bar: the hour `now` is in. A till is left
 * open, so reading `getUTCHours()` once at mount would leave yesterday's 15:00 highlighted at
 * 16:00 — the chart's whole claim is "where are we right now".
 *
 * Africa/Accra is UTC+0 all year (P10-D13), so the boundary is the top of the UTC hour, and no
 * timezone library is involved. The pure helpers are exported so the re-arm maths can be tested
 * under fake timers without a DOM renderer.
 */

/** A whole second of slack, so a slightly early timer cannot re-arm on the same hour. */
export const HOUR_GUARD_MS = 1_000

/** `0…23`, the Accra hour of `now`. */
export function currentAccraHour(now: number = Date.now()): number {
  return new Date(now).getUTCHours()
}

/**
 * Milliseconds until the next Accra hour boundary, plus the guard.
 *
 * At an exact boundary this returns a full hour rather than the guard alone: a timeout of ~1 s
 * would fire inside the same hour and then wait another hour to correct itself.
 */
export function msUntilNextAccraHour(now: number = Date.now()): number {
  const date = new Date(now)
  const elapsed =
    date.getUTCMinutes() * 60_000 + date.getUTCSeconds() * 1_000 + date.getUTCMilliseconds()
  return 3_600_000 - elapsed + HOUR_GUARD_MS
}

/** Re-arm a timeout to the next Accra hour until disposed. */
export function scheduleAccraHourFlip(
  onFlip: () => void,
  now: () => number = Date.now,
): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false

  const arm = (): void => {
    if (disposed) return
    timer = setTimeout(() => {
      if (disposed) return
      onFlip()
      arm()
    }, msUntilNextAccraHour(now()))
  }

  arm()

  return () => {
    disposed = true
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
}

/** `0…23`, re-rendering at the top of each Accra hour. */
export function useCurrentAccraHour(): number {
  const [hour, setHour] = useState(() => currentAccraHour())

  useEffect(() => scheduleAccraHourFlip(() => setHour(currentAccraHour())), [])

  return hour
}
