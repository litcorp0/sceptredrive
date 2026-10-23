import { describe, expect, it } from 'vitest'
import { availablePoints, expiringSoonPoints, expiryHint, pendingPoints } from './balance'

const NOW = new Date('2026-10-23T10:00:00.000Z')

describe('loyalty balance', () => {
  it('adds unacked deltas to the synced balance', () => {
    expect(availablePoints(500, [{ points_delta: 12 }, { points_delta: -250 }])).toBe(262)
  })

  it('shows a negative balance rather than hiding a clawback', () => {
    expect(availablePoints(0, [{ points_delta: -30 }])).toBe(-30)
  })

  it('ignores malformed deltas', () => {
    expect(availablePoints(10, [{ points_delta: Number.NaN }])).toBe(10)
  })

  it('sums pending points separately for the label', () => {
    expect(pendingPoints([{ points_delta: 5 }, { points_delta: 7 }])).toBe(12)
    expect(pendingPoints([])).toBe(0)
  })
})

describe('expiring soon', () => {
  it('counts lots inside the 30-day window', () => {
    const points = expiringSoonPoints(
      [
        { remaining_points: 100, expires_at: '2026-11-01T00:00:00.000Z' },
        { remaining_points: 50, expires_at: '2026-12-01T00:00:00.000Z' },
      ],
      NOW,
    )
    expect(points).toBe(100)
  })

  it('counts already-expired lots as spendable-until-the-server-expires-them', () => {
    expect(
      expiringSoonPoints([{ remaining_points: 40, expires_at: '2026-10-01T00:00:00.000Z' }], NOW),
    ).toBe(40)
  })

  it('ignores consumed lots and unparseable dates', () => {
    expect(
      expiringSoonPoints(
        [
          { remaining_points: 0, expires_at: '2026-11-01T00:00:00.000Z' },
          { remaining_points: 10, expires_at: 'not-a-date' },
        ],
        NOW,
      ),
    ).toBe(0)
  })

  it('honours a custom window', () => {
    expect(
      expiringSoonPoints(
        [{ remaining_points: 10, expires_at: '2026-11-20T00:00:00.000Z' }],
        NOW,
        60,
      ),
    ).toBe(10)
  })
})

describe('expiry hint', () => {
  it('reads naturally', () => {
    expect(expiryHint('2026-10-23T12:00:00.000Z', NOW)).toBe('expires today')
    expect(expiryHint('2026-10-24T12:00:00.000Z', NOW)).toBe('expires tomorrow')
    expect(expiryHint('2026-11-02T10:00:00.000Z', NOW)).toBe('expires in 10 days')
    expect(expiryHint('2026-10-01T10:00:00.000Z', NOW)).toBe('expired')
    expect(expiryHint('nope', NOW)).toBe('no expiry')
  })
})
