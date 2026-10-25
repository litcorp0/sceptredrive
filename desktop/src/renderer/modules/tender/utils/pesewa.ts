/**
 * The pesewa digit model, as two pure functions.
 *
 * The tender keypad types pesewas, not cedis: pressing 5, 0, 0 shows GH₵5.00. That rule lived
 * inside the keypad's click handler, which meant the number row could not share it — and a till
 * has a keyboard. Both entry paths call these now, so a typed amount and a tapped amount cannot
 * disagree.
 */

/** Appends one digit. A leading zero is dropped; nine digits is the ceiling. */
export function appendPesewaDigit(tenderedMinor: number, digit: string): number {
  if (!/^\d$/.test(digit)) return tenderedMinor
  const next = `${tenderedMinor}${digit}`.replace(/^0+(?=\d)/, '')
  if (next.length > 9) return tenderedMinor
  return Number(next)
}

/** Drops the last digit — Backspace, and the keypad's Back key. */
export function removePesewaDigit(tenderedMinor: number): number {
  return Math.floor(tenderedMinor / 10)
}
