import { accraIsoDay } from '@sceptre/shared'
import { describe, expect, it } from 'vitest'
import { dayWindow, fillHours, homeSummary, peakHour, toTopSellers } from './day'

/**
 * The home screen's pure arithmetic (Plan 04 §Pure functions).
 *
 * Two of these cases are cross-client pins rather than local preferences: the average
 * basket fixture is the one `@sceptre/shared`'s own test asserts
 * (`packages/shared/src/money.test.ts`), and the 45 000 / 3 day is the fixture the API's
 * `analytics.test.ts` overview asserts. If the till and the console ever round or sum
 * differently, one of those fails here.
 */

const NO_SALES = {
  sales_count: 0,
  take_minor: 0,
  tax_minor: 0,
  credit_minor: 0,
  change_minor: 0,
}

describe('fillHours', () => {
  it('returns 24 zeroed points, hours 0…23 in order, for an empty day', () => {
    const points = fillHours([])

    expect(points).toHaveLength(24)
    expect(points.map((point) => point.hour)).toEqual(Array.from({ length: 24 }, (_, hour) => hour))
    expect(points.every((point) => point.takeMinor === 0)).toBe(true)
  })

  it('places out-of-order rows, accumulates duplicate hours, and handles hours 0 and 23', () => {
    const points = fillHours([
      { hour: 23, take_minor: 500 },
      { hour: 0, take_minor: 700 },
      { hour: 9, take_minor: 100 },
      { hour: 9, take_minor: 50 },
    ])

    expect(points).toHaveLength(24)
    expect(points[0]?.takeMinor).toBe(700)
    expect(points[9]?.takeMinor).toBe(150)
    expect(points[23]?.takeMinor).toBe(500)
    expect(points[10]?.takeMinor).toBe(0)
    expect(points[22]?.takeMinor).toBe(0)
  })

  it('drops an out-of-range hour rather than inventing a 25th point', () => {
    const points = fillHours([
      { hour: 24, take_minor: 900 },
      { hour: -1, take_minor: 900 },
    ])

    expect(points).toHaveLength(24)
    expect(points.reduce((total, point) => total + point.takeMinor, 0)).toBe(0)
  })
})

describe('peakHour', () => {
  it('is null on a day that took nothing', () => {
    expect(peakHour(fillHours([]))).toBeNull()
    expect(peakHour([])).toBeNull()
  })

  it('returns the busiest hour and ignores empty ones', () => {
    const points = fillHours([
      { hour: 0, take_minor: 0 },
      { hour: 8, take_minor: 1_200 },
      { hour: 17, take_minor: 9_400 },
    ])

    expect(peakHour(points)).toBe(17)
  })

  it('returns the earlier hour on a tie, whatever order the points arrive in', () => {
    const inOrder = fillHours([
      { hour: 10, take_minor: 5_000 },
      { hour: 14, take_minor: 5_000 },
    ])
    const reversed = [...inOrder].reverse()

    expect(peakHour(inOrder)).toBe(10)
    expect(peakHour(reversed)).toBe(10)
  })
})

describe('dayWindow', () => {
  it('is the UTC (= Accra) half-open window for the day', () => {
    expect(dayWindow('2026-10-25')).toEqual({
      day: '2026-10-25',
      from: '2026-10-25T00:00:00.000Z',
      to: '2026-10-26T00:00:00.000Z',
    })
  })

  it('rolls the upper bound over a month and a year', () => {
    expect(dayWindow('2026-12-31').to).toBe('2027-01-01T00:00:00.000Z')
    expect(dayWindow('2026-02-28').to).toBe('2026-03-01T00:00:00.000Z')
  })

  it('excludes a sale a minute before the previous midnight and one at the next midnight', () => {
    const { from, to } = dayWindow('2026-10-25')

    // The SQL filter is a text comparison on ISO timestamps, so this is the same test the
    // statement performs: `occurred_at >= ? AND occurred_at < ?`.
    const inWindow = (occurredAt: string): boolean => occurredAt >= from && occurredAt < to

    expect(inWindow('2026-10-24T23:59:00.000Z')).toBe(false)
    expect(inWindow('2026-10-25T00:00:00.000Z')).toBe(true)
    expect(inWindow('2026-10-25T23:59:59.999Z')).toBe(true)
    expect(inWindow('2026-10-26T00:00:00.000Z')).toBe(false)
  })
})

describe('the hourly bucket', () => {
  it('reads the hour out of the stored ISO string, which is UTC and therefore Accra', () => {
    // `HOURLY_SHAPE_SQL` uses `CAST(substr(occurred_at, 12, 2) AS INTEGER)`. `occurred_at`
    // is written as `toISOString()`, and Africa/Accra is UTC+0 with no DST, so the twelfth
    // character is the Accra hour. If a non-zero offset is ever introduced, this fails.
    for (const iso of [
      '2026-10-25T00:05:00.000Z',
      '2026-10-25T12:00:00.000Z',
      '2026-10-25T23:59:59.999Z',
    ]) {
      expect(Number(iso.slice(11, 13))).toBe(new Date(iso).getUTCHours())
      expect(accraIsoDay(new Date(iso))).toBe('2026-10-25')
    }
  })
})

describe('homeSummary', () => {
  it('is all zeroes on a day with no sales, with an average of 0 rather than NaN', () => {
    const summary = homeSummary({ header: NO_SALES, itemsSold: 0, drawer: null })

    expect(summary.salesCount).toBe(0)
    expect(summary.takeMinor).toBe(0)
    expect(summary.averageBasketMinor).toBe(0)
    expect(Object.is(summary.averageBasketMinor, -0)).toBe(false)
    expect(summary.itemsSold).toBe(0)
    // The UI contract: no sales means "—", never `GHS 0.00` (P10-D3).
    expect(summary.hasSales).toBe(false)
  })

  it('treats a missing header row as an empty day, so a cold start cannot show NaN', () => {
    const summary = homeSummary({ header: null, itemsSold: 0, drawer: null })

    expect(summary.takeMinor).toBe(0)
    expect(summary.averageBasketMinor).toBe(0)
    expect(summary.hasSales).toBe(false)
  })

  it('yields take 24 500 and average 12 250 for a GH₵150.00 and a GH₵95.00 sale', () => {
    // 15 000 + 9 500 = 24 500 over two sales. The same pair is asserted against
    // `averageBasketMinor` in `packages/shared/src/money.test.ts`, so the POS and the API
    // cannot round this differently.
    const summary = homeSummary({
      header: {
        sales_count: 2,
        take_minor: 24_500,
        tax_minor: 4_083,
        credit_minor: 9_500,
        change_minor: 500,
      },
      itemsSold: 3,
      drawer: { expectedCashMinor: 31_500, shiftNumber: 'T1-S-20261025-01' },
    })

    expect(summary.takeMinor).toBe(24_500)
    expect(summary.salesCount).toBe(2)
    expect(summary.averageBasketMinor).toBe(12_250)
    expect(summary.hasSales).toBe(true)
    expect(summary.expectedCashMinor).toBe(31_500)
    expect(summary.shiftNumber).toBe('T1-S-20261025-01')
  })

  it('matches the API overview fixture: 45 000 over 3 sales averages 15 000', () => {
    // `api/src/modules/analytics/analytics.test.ts` asserts takeMinor 45 000,
    // salesCount 3, avgBasketMinor 15 000 for its overview fixture.
    const summary = homeSummary({
      header: { ...NO_SALES, sales_count: 3, take_minor: 45_000 },
      itemsSold: 5,
      drawer: null,
    })

    expect(summary.takeMinor).toBe(45_000)
    expect(summary.salesCount).toBe(3)
    expect(summary.itemsSold).toBe(5)
    expect(summary.averageBasketMinor).toBe(15_000)
  })

  it('reports no drawer figure when no shift is open', () => {
    const summary = homeSummary({ header: NO_SALES, itemsSold: 0, drawer: null })

    expect(summary.expectedCashMinor).toBeNull()
    expect(summary.shiftNumber).toBeNull()
  })
})

describe('toTopSellers', () => {
  it('renames the columns and keeps the query order', () => {
    expect(
      toTopSellers([
        { product_id: 'p1', name: 'Rice 5kg', quantity: 4, revenue_minor: 12_000 },
        { product_id: 'p2', name: 'Sugar 1kg', quantity: 2, revenue_minor: 3_200 },
      ]),
    ).toEqual([
      { productId: 'p1', name: 'Rice 5kg', quantity: 4, revenueMinor: 12_000 },
      { productId: 'p2', name: 'Sugar 1kg', quantity: 2, revenueMinor: 3_200 },
    ])
  })
})
