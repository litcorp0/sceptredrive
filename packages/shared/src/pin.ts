/**
 * POS PIN policy, shared by the API, the console, and the terminal.
 *
 * PINs are 4–6 digits. The shape check is deliberately the only structural
 * rule (no letters, no whitespace), and trivial patterns are rejected because a
 * short numeric secret is only defensible when it is not guessable.
 */

export const PIN_MIN_LENGTH = 4
export const PIN_MAX_LENGTH = 6

/** Digits only, 4–6 characters. */
export function isValidPinShape(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin)
}

/**
 * Rejects PINs that carry no entropy beyond their length:
 * - every digit identical (`0000`, `777777`),
 * - a straight ascending or descending run (`1234`, `987654`).
 *
 * A wrapping run (`8901`) is not accepted as trivial here: it is rarer, and
 * over-rejecting PINs annoys operators more than it protects them.
 */
export function isTrivialPin(pin: string): boolean {
  if (pin.length === 0) return false

  const digits = [...pin].map((character) => character.charCodeAt(0))
  const allSame = digits.every((digit) => digit === digits[0])
  if (allSame) return true

  let ascending = true
  let descending = true
  for (let index = 1; index < digits.length; index += 1) {
    const current = digits[index] ?? 0
    const previous = digits[index - 1] ?? 0
    const step = current - previous
    if (step !== 1) ascending = false
    if (step !== -1) descending = false
  }
  return ascending || descending
}

export type PinProblem = 'SHAPE' | 'TRIVIAL'

/** `null` when the PIN is acceptable; otherwise the reason it is not. */
export function pinProblem(pin: string): PinProblem | null {
  if (!isValidPinShape(pin)) return 'SHAPE'
  if (isTrivialPin(pin)) return 'TRIVIAL'
  return null
}

export const PIN_PROBLEM_MESSAGES: Record<PinProblem, string> = {
  SHAPE: `A PIN must be ${PIN_MIN_LENGTH}–${PIN_MAX_LENGTH} digits`,
  TRIVIAL: 'Choose a PIN that is not a repeated digit or a straight sequence',
}
