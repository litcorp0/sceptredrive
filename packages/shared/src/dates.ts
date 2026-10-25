/**
 * Every date and time the product renders goes through this file.
 *
 * Locale is `en-GB` because Ghana retail reads `24 Oct 2026`, never `10/24/2026`.
 * The timezone is the runtime's: **Africa/Accra is UTC+0 all year and Ghana has no DST**,
 * so no timezone library is needed and `@date-fns/tz` must not be added. The one deliberate
 * exception is `accraDay`, which is a numbering key rather than display and therefore reads
 * the UTC calendar day directly.
 *
 * Two rules that matter:
 * - Formatting is display only. Nothing here returns a number, and **no helper divides money
 *   by 100** — `formatGhs` stays the single money formatter.
 * - Invalid input renders `—` rather than `Invalid Date`.
 */
import { differenceInCalendarDays, format, getISOWeek, isValid, parseISO } from 'date-fns'
import { enGB } from 'date-fns/locale/en-GB'

export type DateInput = string | number | Date

export type BucketGranularity = 'day' | 'week' | 'month'

/** Shown instead of `Invalid Date` when a value cannot be parsed. */
export const INVALID_DATE = '—'

const LOCALE = { locale: enGB }

function parse(value: DateInput): Date | null {
  const date =
    value instanceof Date ? value : typeof value === 'number' ? new Date(value) : parseISO(value)
  return isValid(date) ? date : null
}

function render(value: DateInput, pattern: string): string {
  const date = parse(value)
  return date ? format(date, pattern, LOCALE) : INVALID_DATE
}

/** `24 Oct 2026` — the default date everywhere: tables, statements, headers. */
export function formatDay(value: DateInput): string {
  return render(value, 'd MMM yyyy')
}

/** `24 Oct` — chart axes and compact rows where the year is implied. */
export function formatDayShort(value: DateInput): string {
  return render(value, 'd MMM')
}

/** `24 Oct 2026, 14:32` — ledger rows, audit entries, absolute timestamps. */
export function formatDateTime(value: DateInput): string {
  return render(value, 'd MMM yyyy, HH:mm')
}

/** `14:32` — shift open/close, movement times, receipt times. */
export function formatTime(value: DateInput): string {
  return render(value, 'HH:mm')
}

/** `Oct 2026` — month buckets and period labels. */
export function formatMonth(value: DateInput): string {
  return render(value, 'MMM yyyy')
}

/**
 * A date range in the shortest unambiguous form:
 * `1–24 Oct 2026`, `28 Sep – 4 Oct 2026`, `1 Dec 2025 – 4 Jan 2026`.
 */
export function formatRange(from: DateInput, to: DateInput): string {
  const start = parse(from)
  const end = parse(to)
  if (!start || !end) return INVALID_DATE

  const startDay = format(start, 'd', LOCALE)
  const startMonth = format(start, 'MMM', LOCALE)
  const endDay = format(end, 'd', LOCALE)
  const endMonth = format(end, 'MMM', LOCALE)
  const startYear = format(start, 'yyyy', LOCALE)
  const endYear = format(end, 'yyyy', LOCALE)

  if (startYear !== endYear) {
    return `${startDay} ${startMonth} ${startYear} – ${endDay} ${endMonth} ${endYear}`
  }
  if (startMonth !== endMonth) {
    return `${startDay} ${startMonth} – ${endDay} ${endMonth} ${endYear}`
  }
  if (startDay === endDay) return `${startDay} ${startMonth} ${startYear}`
  return `${startDay}–${endDay} ${endMonth} ${endYear}`
}

/**
 * "How long ago" — only where elapsed time is the actual question (sync status, audit
 * context). Never in a ledger: those need the absolute timestamp.
 *
 * `just now`, `2 min ago`, `3 h ago`, `yesterday`, `in 3 days`, and beyond 30 days the
 * absolute day.
 */
export function formatRelative(value: DateInput, now: Date | number = Date.now()): string {
  const date = parse(value)
  const reference = parse(now)
  if (!date || !reference) return INVALID_DATE

  const elapsedMs = date.getTime() - reference.getTime()
  const past = elapsedMs < 0
  const minutes = Math.floor(Math.abs(elapsedMs) / 60_000)

  if (minutes < 1) return 'just now'

  const calendarDays = differenceInCalendarDays(date, reference)
  if (calendarDays === 0) {
    if (minutes < 60) return past ? `${minutes} min ago` : `in ${minutes} min`
    const hours = Math.floor(minutes / 60)
    return past ? `${hours} h ago` : `in ${hours} h`
  }
  if (calendarDays === -1) return 'yesterday'
  if (calendarDays === 1) return 'tomorrow'

  const days = Math.abs(calendarDays)
  if (days <= 30) return past ? `${days} days ago` : `in ${days} days`
  return formatDay(date)
}

/** Chart-axis bucket: `24 Oct`, `Wk 43`, or `Oct 2026`. */
export function formatBucket(value: DateInput, granularity: BucketGranularity): string {
  const date = parse(value)
  if (!date) return INVALID_DATE
  if (granularity === 'week') {
    return `Wk ${String(getISOWeek(date)).padStart(2, '0')}`
  }
  if (granularity === 'month') return formatMonth(date)
  return formatDayShort(date)
}

/** `1,240` — integer grouping for points, counts, and row totals. */
export function formatCount(value: number): string {
  if (!Number.isFinite(value)) return INVALID_DATE
  return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 }).format(value)
}

/** `2026-10-24` for `<input type="date">`. */
export function toDateInputValue(value: DateInput): string {
  return render(value, 'yyyy-MM-dd')
}

/** `2026-10-24T14:32` for `<input type="datetime-local">`. */
export function toDateTimeInputValue(value: DateInput): string {
  return render(value, "yyyy-MM-dd'T'HH:mm")
}

/**
 * `20261024` — the shift and receipt-number day.
 *
 * A numbering key, not display: it must be the calendar day in Accra at the moment of the
 * transaction, which for UTC+0 is the UTC day. Kept independent of the host timezone so a
 * terminal laptop set to another zone cannot produce a receipt number from the wrong day.
 */
export function accraDay(now: Date | number = new Date()): string {
  const date = parse(now)
  if (!date) return ''
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}${month}${day}`
}

/**
 * `2026-10-24` — the Accra calendar day as an ISO date.
 *
 * This is the day boundary every report uses. Africa/Accra is UTC+0 all year, so the UTC
 * calendar day *is* the Accra day; reading it from UTC parts keeps a server in another zone
 * from reporting a sale on the wrong day. A value that is already a `YYYY-MM-DD` string is
 * returned unchanged, so a round-trip through a query parameter cannot shift it.
 */
export function accraIsoDay(value: DateInput = new Date()): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = parse(value)
  if (!date) return INVALID_DATE
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * `23 Oct 2026 10:15` — the printed sale timestamp on a receipt.
 *
 * Explicit UTC (= Africa/Accra) on purpose: paper is a hardware contract, and a terminal
 * laptop whose clock sits in another zone must print the same day the receipt number was
 * allocated from. The local-time helpers above are for screens, where "today" is the
 * operator's day; this one is for a document that must not move.
 *
 * `Intl` is used only here, because date-fns formats in the host zone and the alternative is
 * a timezone library the product deliberately does not carry.
 */
export function formatAccraDateTime(value: DateInput): string {
  const date = parse(value)
  if (!date) return INVALID_DATE
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
  return `${day} ${time}`
}
