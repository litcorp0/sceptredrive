import { describe, expect, it } from 'vitest'
import { createScanBuffer, SCAN_MAX_GAP_MS, SCAN_MIN_LENGTH } from './scan-buffer'

function scan(buffer: ReturnType<typeof createScanBuffer>, code: string, startAt = 1000, gap = 10) {
  let at = startAt
  for (const character of code) {
    buffer.push(character, at)
    at += gap
  }
  return { result: buffer.push('\n', at), at }
}

describe('scan buffer', () => {
  it('returns the code when Enter terminates a fast burst', () => {
    const buffer = createScanBuffer()
    expect(scan(buffer, '4006381333931').result).toBe('4006381333931')
    expect(buffer.size()).toBe(0)
  })

  it('accepts a burst at the gap limit', () => {
    const buffer = createScanBuffer()
    expect(scan(buffer, '12345', 1000, SCAN_MAX_GAP_MS).result).toBe('12345')
  })

  it('rejects a burst slower than the gap limit', () => {
    const buffer = createScanBuffer()
    // Each character arrives too late: the buffer restarts every time, so the
    // Enter only ever sees the final character.
    expect(scan(buffer, '12345', 1000, SCAN_MAX_GAP_MS + 1).result).toBeNull()
  })

  it('collapses a human-paced pause in the middle of a scan', () => {
    const buffer = createScanBuffer()
    buffer.push('1', 1000)
    buffer.push('2', 1010)
    // 500 ms later: a new burst.
    buffer.push('3', 1510)
    buffer.push('4', 1520)
    buffer.push('5', 1525)
    expect(buffer.push('\n', 1530)).toBe('345')
  })

  it('ignores a code shorter than the minimum', () => {
    const buffer = createScanBuffer()
    expect(scan(buffer, 'a'.repeat(SCAN_MIN_LENGTH - 1)).result).toBeNull()
  })

  it('ignores control characters and multi-character keys', () => {
    const buffer = createScanBuffer()
    buffer.push('1', 1000)
    buffer.push('Shift', 1005)
    buffer.push('\u0000', 1010)
    buffer.push('2', 1015)
    buffer.push('3', 1018)
    expect(buffer.push('\n', 1020)).toBe('123')
  })

  it('supports carriage return as the terminator', () => {
    const buffer = createScanBuffer()
    buffer.push('9', 1000)
    buffer.push('8', 1010)
    buffer.push('7', 1020)
    expect(buffer.push('\r', 1030)).toBe('987')
  })

  it('can be reset', () => {
    const buffer = createScanBuffer()
    buffer.push('1', 1000)
    buffer.push('2', 1005)
    buffer.reset()
    expect(buffer.size()).toBe(0)
    expect(buffer.lastAt()).toBeNull()
  })
})
