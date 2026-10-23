import { describe, expect, it } from 'vitest'
import { isUuid, uuidv7 } from './id'

describe('uuidv7', () => {
  it('is a version 7, variant 10 UUID', () => {
    const id = uuidv7(1_700_000_000_000)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('encodes the timestamp so ids sort by creation time', () => {
    const earlier = uuidv7(1_700_000_000_000)
    const later = uuidv7(1_700_000_001_000)
    expect(earlier < later).toBe(true)

    // 1_700_000_000_000 = 0x18BCFE56800 -> the leading 48 bits of the id.
    expect(earlier.startsWith('018bcfe5-6800')).toBe(true)
  })

  it('does not repeat itself under fast calls', () => {
    const ids = new Set(Array.from({ length: 500 }, () => uuidv7()))
    expect(ids.size).toBe(500)
  })

  it('refuses an out-of-range timestamp', () => {
    expect(() => uuidv7(-1)).toThrow(RangeError)
    expect(() => uuidv7(2 ** 49)).toThrow(RangeError)
  })
})

describe('isUuid', () => {
  it('accepts a generated id and rejects junk', () => {
    expect(isUuid(uuidv7())).toBe(true)
    expect(isUuid('not-a-uuid')).toBe(false)
    expect(isUuid(null)).toBe(false)
    expect(isUuid(42)).toBe(false)
  })
})
