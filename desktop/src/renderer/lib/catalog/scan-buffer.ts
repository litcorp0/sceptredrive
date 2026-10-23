/**
 * Barcode wedge detection (Plan 06 Task 2).
 *
 * A USB scanner is a keyboard: it types the code and presses Enter, usually
 * faster than a human can. We accumulate printable characters and only accept
 * a burst whose gaps are short, so a cashier typing a customer name never
 * registers as a scan. Pure and time-injectable, so the timing rules are
 * unit-tested without a keyboard.
 */

export const SCAN_MAX_GAP_MS = 60
export const SCAN_MIN_LENGTH = 3

export interface ScanBuffer {
  /** Feed one printable character; returns a code only on a completed scan. */
  push(character: string, at?: number): string | null
  /** Bytes collected so far, for diagnostics. */
  size(): number
  reset(): void
  /** Time of the last accepted character, or null. */
  lastAt(): number | null
}

export function createScanBuffer(
  options: { maxGapMs?: number; minLength?: number } = {},
): ScanBuffer {
  const maxGapMs = options.maxGapMs ?? SCAN_MAX_GAP_MS
  const minLength = options.minLength ?? SCAN_MIN_LENGTH

  let characters: string[] = []
  let lastTimestamp: number | null = null

  function reset(): void {
    characters = []
    lastTimestamp = null
  }

  return {
    push(character: string, at = Date.now()): string | null {
      // A slow character belongs to whatever the cashier is doing, not to a
      // scanner burst: start over rather than glue two inputs together.
      if (lastTimestamp !== null && at - lastTimestamp > maxGapMs) {
        characters = []
      }

      if (character === '\n' || character === '\r') {
        const code = characters.join('')
        reset()
        return code.length >= minLength ? code : null
      }

      if (character.length !== 1) return null
      const codePoint = character.charCodeAt(0)
      if (codePoint < 0x20 || codePoint === 0x7f) return null

      characters.push(character)
      lastTimestamp = at
      return null
    },

    size: () => characters.length,
    reset,
    lastAt: () => lastTimestamp,
  }
}
