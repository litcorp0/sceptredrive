import { describe, expect, it } from 'vitest'
import { runtimeStatus } from './pos-runtime'

describe('runtimeStatus', () => {
  it('waits for the config row on a cold start', () => {
    expect(runtimeStatus({ hasConfigRow: false, configLoading: true, shiftLoading: false })).toBe(
      'loading',
    )
  })

  it('waits for the shift query even when the config is ready', () => {
    expect(runtimeStatus({ hasConfigRow: true, configLoading: false, shiftLoading: true })).toBe(
      'loading',
    )
  })

  it('is ready once both queries settle', () => {
    expect(runtimeStatus({ hasConfigRow: true, configLoading: false, shiftLoading: false })).toBe(
      'ready',
    )
    expect(runtimeStatus({ hasConfigRow: true, configLoading: true, shiftLoading: false })).toBe(
      'ready',
    )
  })
})
