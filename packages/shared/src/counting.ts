/**
 * Cycle-count arithmetic: when a schedule is next due, which ABC class a share
 * earns, and how accurate a period's counts were.
 *
 * Every date here is a bare `YYYY-MM-DD` calendar day, and every operation is
 * done on calendar parts. `new Date('2026-01-31')` parses as *local* midnight,
 * and adding 86 400 000 milliseconds crosses no calendar at all, so neither is
 * used: a month-end advance clamps to the target month's length instead of
 * drifting into the next one. Accra is UTC+0 all year, so the day a count was
 * posted is read with `accraIsoDay`, never from the host zone.
 *
 * Nothing in this file reads a database and nothing divides money.
 */
import { accraIsoDay } from './dates.ts'
import { ratioBp } from './percent.ts'

export const COUNT_FREQUENCIES = ['WEEKLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL'] as const

export type CountFrequency = (typeof COUNT_FREQUENCIES)[number]

/** Calendar months added by one period. Weekly is day arithmetic, not months. */
const MONTHS_PER_PERIOD: Record<CountFrequency, number> = {
  WEEKLY: 0,
  MONTHLY: 1,
  QUARTERLY: 3,
  BIANNUAL: 6,
}

/** Periods in a year, used to spread a rotation count across the catalogue. */
const PERIODS_PER_YEAR: Record<CountFrequency, number> = {
  WEEKLY: 52,
  MONTHLY: 12,
  QUARTERLY: 4,
  BIANNUAL: 2,
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/

const DAYS_PER_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const

interface CalendarDay {
  year: number
  /** 1…12. */
  month: number
  /** 1…the month's length. */
  day: number
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28
  const days = DAYS_PER_MONTH[month - 1]
  if (days === undefined) throw new TypeError('month must be between 1 and 12')
  return days
}

function assertFrequency(frequency: CountFrequency): void {
  if (!(COUNT_FREQUENCIES as readonly string[]).includes(frequency)) {
    throw new TypeError(`unknown count frequency: ${String(frequency)}`)
  }
}

function parseIsoDay(isoDay: string): CalendarDay {
  const match = ISO_DAY.exec(isoDay)
  if (!match) throw new TypeError('isoDay must be a YYYY-MM-DD calendar day')

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (!Number.isSafeInteger(year) || !Number.isSafeInteger(month) || !Number.isSafeInteger(day)) {
    throw new TypeError('isoDay must be a YYYY-MM-DD calendar day')
  }
  if (month < 1 || month > 12) throw new TypeError('isoDay month must be between 01 and 12')
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new TypeError('isoDay is not a day that exists in that month')
  }
  return { year, month, day }
}

function formatIsoDay({ year, month, day }: CalendarDay): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function addDays(start: CalendarDay, days: number): CalendarDay {
  let year = start.year
  let month = start.month
  let day = start.day
  let remaining = days

  while (remaining > 0) {
    const leftInMonth = daysInMonth(year, month) - day
    if (remaining <= leftInMonth) {
      day += remaining
      remaining = 0
    } else {
      remaining -= leftInMonth + 1
      day = 1
      month += 1
      if (month > 12) {
        month = 1
        year += 1
      }
    }
  }

  return { year, month, day }
}

/** Exact integer ceiling division for a non-negative numerator. */
function ceilDivide(numerator: number, denominator: number): number {
  const remainder = numerator % denominator
  return (numerator - remainder) / denominator + (remainder === 0 ? 0 : 1)
}

function assertBasisPoints(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer in basis points`)
  }
}

/**
 * `YYYY-MM-DD` → the next due day for a frequency, Accra calendar, month-end
 * clamped: `2026-01-31` + MONTHLY is `2026-02-28`, and `2028-01-31` + MONTHLY is
 * `2028-02-29`.
 *
 * Throws `TypeError` on a day that does not exist or an unknown frequency: this
 * feeds a schedule advance, where a silently wrong answer stops a category being
 * counted forever (P12-D34).
 */
export function advanceDueDate(isoDay: string, frequency: CountFrequency): string {
  assertFrequency(frequency)
  const start = parseIsoDay(isoDay)

  if (frequency === 'WEEKLY') return formatIsoDay(addDays(start, 7))

  const monthIndex = start.month - 1 + MONTHS_PER_PERIOD[frequency]
  const year = start.year + (monthIndex - (monthIndex % 12)) / 12
  const month = (monthIndex % 12) + 1
  const day = Math.min(start.day, daysInMonth(year, month))
  return formatIsoDay({ year, month, day })
}

/**
 * True when a posted count met its due date.
 *
 * A count without a due date is never late. A count that has not been posted
 * cannot have met one, so a null `postedAt` is not on time. The comparison is
 * between Accra calendar days, not instants: a count posted at 23:59 on its due
 * day is on time, and one posted at 00:00 the next day is not.
 *
 * Throws `TypeError` when `dueAt` is not a calendar day that exists — a stored
 * due date is a `date` column, so anything else is a programming error rather
 * than a late count.
 */
export function isCountOnTime(postedAt: Date | string | null, dueAt: string | null): boolean {
  if (dueAt === null) return true
  if (postedAt === null) return false
  parseIsoDay(dueAt) // validates the shape; the comparison is lexicographic on ISO days

  const postedDay = accraIsoDay(postedAt)
  if (!ISO_DAY.test(postedDay)) return false
  return postedDay <= dueAt
}

/**
 * A ≤ aBp → `'A'`; ≤ bBp → `'B'`; else `'C'`. Shares are basis points of the
 * branch total, so the thresholds are cumulative, not per-class (P12-D29).
 */
export function abcClassFromShare(
  shareBp: number,
  aThresholdBp: number,
  bThresholdBp: number,
): 'A' | 'B' | 'C' {
  assertBasisPoints(shareBp, 'shareBp')
  assertBasisPoints(aThresholdBp, 'aThresholdBp')
  assertBasisPoints(bThresholdBp, 'bThresholdBp')
  if (aThresholdBp > bThresholdBp) {
    throw new TypeError('aThresholdBp must not exceed bThresholdBp')
  }

  if (shareBp <= aThresholdBp) return 'A'
  if (shareBp <= bThresholdBp) return 'B'
  return 'C'
}

/**
 * matched / counted in basis points, rounded half away from zero; `null` — never
 * `0` — when nothing was counted (P12-D33).
 *
 * `ratioBp` owns the division and the zero-denominator rule; this adds the one
 * check a count has that a generic ratio does not: matched lines are a subset of
 * counted lines, so more matched than counted is a bug, not a 101% score.
 */
export function countAccuracyBp(matchedLines: number, countedLines: number): number | null {
  if (!Number.isSafeInteger(matchedLines) || matchedLines < 0) {
    throw new TypeError('matchedLines must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(countedLines) || countedLines < 0) {
    throw new TypeError('countedLines must be a non-negative safe integer')
  }
  if (matchedLines > countedLines) {
    throw new TypeError('matchedLines must not exceed countedLines')
  }
  return ratioBp(matchedLines, countedLines)
}

/**
 * How many parts a ROTATION count must include so the whole catalogue is covered
 * once per period: `ceil(activeCount / periodsPerYear)`, minimum 1.
 *
 * WEEKLY 52, MONTHLY 12, QUARTERLY 4, BIANNUAL 2. An empty catalogue still asks
 * for one part, because a count of zero lines proves nothing.
 */
export function rotationBatchSize(activeCount: number, frequency: CountFrequency): number {
  if (!Number.isSafeInteger(activeCount) || activeCount < 0) {
    throw new TypeError('activeCount must be a non-negative safe integer')
  }
  assertFrequency(frequency)

  const size = ceilDivide(activeCount, PERIODS_PER_YEAR[frequency])
  return size < 1 ? 1 : size
}
