import { describe, expect, it } from 'vitest'
import {
  accraDay,
  formatAccraDateTime,
  formatBucket,
  formatCount,
  formatDateTime,
  formatDay,
  formatDayShort,
  formatMonth,
  formatRange,
  formatRelative,
  formatTime,
  INVALID_DATE,
  toDateInputValue,
  toDateTimeInputValue,
} from './dates.ts'

const NOW = new Date('2026-10-24T14:32:00.000Z')

describe('formatDay and friends', () => {
  it('formats a normal date in en-GB order', () => {
    expect(formatDay('2026-10-24T14:32:00.000Z')).toBe('24 Oct 2026')
    expect(formatDayShort('2026-10-24T14:32:00.000Z')).toBe('24 Oct')
    expect(formatDateTime('2026-10-24T14:32:00.000Z')).toBe('24 Oct 2026, 14:32')
    expect(formatTime('2026-10-24T14:32:00.000Z')).toBe('14:32')
    expect(formatMonth('2026-10-24T14:32:00.000Z')).toBe('Oct 2026')
  })

  it('handles a leap day', () => {
    expect(formatDay('2028-02-29T09:05:00.000Z')).toBe('29 Feb 2028')
    expect(formatDateTime('2028-02-29T23:59:00.000Z')).toBe('29 Feb 2028, 23:59')
  })

  it('accepts Date and epoch-millisecond input as well as ISO strings', () => {
    expect(formatDay(new Date('2026-10-24T00:00:00.000Z'))).toBe('24 Oct 2026')
    expect(formatDay(Date.parse('2026-10-24T00:00:00.000Z'))).toBe('24 Oct 2026')
  })

  it('returns a dash for invalid input instead of Invalid Date', () => {
    expect(formatDay('not a date')).toBe(INVALID_DATE)
    expect(formatDateTime('')).toBe(INVALID_DATE)
    expect(formatTime(Number.NaN)).toBe(INVALID_DATE)
    expect(formatRange('nope', '2026-10-24')).toBe(INVALID_DATE)
    expect(formatRelative('nope', NOW)).toBe(INVALID_DATE)
    expect(formatBucket('nope', 'day')).toBe(INVALID_DATE)
    expect(toDateInputValue('nope')).toBe(INVALID_DATE)
  })
})

describe('formatRange', () => {
  it('collapses a range inside one month', () => {
    expect(formatRange('2026-10-01T00:00:00.000Z', '2026-10-24T00:00:00.000Z')).toBe(
      '1–24 Oct 2026',
    )
  })

  it('keeps both months inside one year', () => {
    expect(formatRange('2026-09-28T00:00:00.000Z', '2026-10-04T00:00:00.000Z')).toBe(
      '28 Sep – 4 Oct 2026',
    )
  })

  it('keeps both years across a year boundary', () => {
    expect(formatRange('2025-12-01T00:00:00.000Z', '2026-01-04T00:00:00.000Z')).toBe(
      '1 Dec 2025 – 4 Jan 2026',
    )
  })

  it('renders a single day once', () => {
    expect(formatRange('2026-10-24T00:00:00.000Z', '2026-10-24T18:00:00.000Z')).toBe('24 Oct 2026')
  })
})

describe('formatRelative', () => {
  it('says just now inside the first minute', () => {
    expect(formatRelative('2026-10-24T14:31:30.000Z', NOW)).toBe('just now')
    expect(formatRelative('2026-10-24T14:32:30.000Z', NOW)).toBe('just now')
  })

  it('counts minutes and hours on the same calendar day', () => {
    expect(formatRelative('2026-10-24T14:30:00.000Z', NOW)).toBe('2 min ago')
    expect(formatRelative('2026-10-24T14:50:00.000Z', NOW)).toBe('in 18 min')
    expect(formatRelative('2026-10-24T11:32:00.000Z', NOW)).toBe('3 h ago')
    expect(formatRelative('2026-10-24T18:32:00.000Z', NOW)).toBe('in 4 h')
  })

  it('names yesterday and tomorrow', () => {
    expect(formatRelative('2026-10-23T20:00:00.000Z', NOW)).toBe('yesterday')
    expect(formatRelative('2026-10-25T06:00:00.000Z', NOW)).toBe('tomorrow')
  })

  it('counts days in both directions', () => {
    expect(formatRelative('2026-10-21T14:32:00.000Z', NOW)).toBe('3 days ago')
    expect(formatRelative('2026-10-27T14:32:00.000Z', NOW)).toBe('in 3 days')
  })

  it('falls back to the absolute day beyond a month', () => {
    expect(formatRelative('2026-08-01T14:32:00.000Z', NOW)).toBe('1 Aug 2026')
  })
})

describe('formatBucket', () => {
  it('renders day, ISO week, and month buckets', () => {
    expect(formatBucket('2026-10-24T14:32:00.000Z', 'day')).toBe('24 Oct')
    expect(formatBucket('2026-10-24T14:32:00.000Z', 'week')).toBe('Wk 43')
    expect(formatBucket('2026-10-24T14:32:00.000Z', 'month')).toBe('Oct 2026')
  })

  it('pads early weeks', () => {
    expect(formatBucket('2026-01-02T00:00:00.000Z', 'week')).toBe('Wk 01')
  })
})

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(1240)).toBe('1,240')
    expect(formatCount(0)).toBe('0')
    expect(formatCount(999)).toBe('999')
    expect(formatCount(1_234_567)).toBe('1,234,567')
  })

  it('rounds away fractions and rejects non-finite input', () => {
    expect(formatCount(12.6)).toBe('13')
    expect(formatCount(Number.POSITIVE_INFINITY)).toBe(INVALID_DATE)
  })
})

describe('input values', () => {
  it('renders the native input formats', () => {
    expect(toDateInputValue('2026-10-24T14:32:00.000Z')).toBe('2026-10-24')
    expect(toDateTimeInputValue('2026-10-24T14:32:00.000Z')).toBe('2026-10-24T14:32')
  })

  it('keeps the minutes of a midnight timestamp', () => {
    expect(toDateTimeInputValue('2026-10-24T00:05:00.000Z')).toBe('2026-10-24T00:05')
  })
})

describe('accraDay', () => {
  it('uses the UTC calendar day at both ends of the day', () => {
    expect(accraDay(new Date('2026-10-22T00:00:00.000Z'))).toBe('20261022')
    expect(accraDay(new Date('2026-10-22T23:59:59.000Z'))).toBe('20261022')
    expect(accraDay(new Date('2026-10-23T00:00:01.000Z'))).toBe('20261023')
  })

  it('is independent of the host timezone offset', () => {
    expect(accraDay(Date.parse('2026-12-31T23:30:00.000Z'))).toBe('20261231')
  })
})

describe('formatAccraDateTime', () => {
  it('prints the Accra (UTC) timestamp used on receipts', () => {
    expect(formatAccraDateTime('2026-10-23T10:15:00.000Z')).toBe('23 Oct 2026 10:15')
    expect(formatAccraDateTime('2026-10-23T23:59:00.000Z')).toBe('23 Oct 2026 23:59')
    expect(formatAccraDateTime('2028-02-29T00:05:00.000Z')).toBe('29 Feb 2028 00:05')
  })

  it('returns a dash for an unparseable value', () => {
    expect(formatAccraDateTime('not-a-date')).toBe(INVALID_DATE)
  })
})
