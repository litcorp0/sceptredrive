import { describe, expect, it } from 'vitest'
import { FLAG_DEFAULTS, FLAG_DESCRIPTIONS, FLAG_KEYS, isFlagKey } from './flags.ts'

describe('flag registry', () => {
  it('has three unique flag.* keys', () => {
    expect(FLAG_KEYS).toEqual([
      'flag.supplierTransfers',
      'flag.evatSubmission',
      'flag.posConflictResolution',
    ])
    expect(new Set(FLAG_KEYS).size).toBe(FLAG_KEYS.length)
    for (const key of FLAG_KEYS) {
      expect(key.startsWith('flag.')).toBe(true)
    }
  })

  it('defaults every flag on, because this phase ships the features', () => {
    for (const key of FLAG_KEYS) {
      expect(FLAG_DEFAULTS[key]).toBe(true)
    }
  })

  it('describes every flag in terms a manager can act on', () => {
    for (const key of FLAG_KEYS) {
      expect(FLAG_DESCRIPTIONS[key].length).toBeGreaterThan(0)
    }
  })

  it('recognises a flag key and rejects anything else', () => {
    for (const key of FLAG_KEYS) {
      expect(isFlagKey(key)).toBe(true)
    }
    expect(isFlagKey('flag.nope')).toBe(false)
    expect(isFlagKey('supplierTransfers')).toBe(false)
    expect(isFlagKey('')).toBe(false)
  })
})
