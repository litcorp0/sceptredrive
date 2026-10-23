/** Money helpers. Storage is integer pesewas; display is Ghana cedis. */

const cedis = new Intl.NumberFormat('en-GH', {
  style: 'currency',
  currency: 'GHS',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatGhs(minor: number): string {
  return cedis.format(minor / 100)
}

/**
 * Integer-only pesewa formatting for receipt columns (`1234.50`).
 *
 * The POS printer cannot render `GH₵` on every charset, and recalculating
 * through a float to format paper money is exactly the drift the integer rule
 * exists to prevent. This splits the minor units with `Math.trunc`/modulo.
 */
export function formatMinorPlain(minor: number): string {
  const sign = minor < 0 ? '-' : ''
  const absolute = Math.abs(minor)
  const whole = Math.trunc(absolute / 100)
  const fraction = String(absolute % 100).padStart(2, '0')
  return `${sign}${whole}.${fraction}`
}

/** `GHS 1234.50` or `GH₵ 1234.50` — the printer charset decides which. */
export function formatMinorWithSymbol(minor: number, symbol: string): string {
  return `${symbol} ${formatMinorPlain(minor)}`
}

/**
 * Parses a typed cedi amount into integer pesewas. Accepts `12`, `12.5`, and
 * `12.50`; rejects negative, non-numeric, or more than two decimal places.
 */
export function parseGhsToMinor(value: string): number | null {
  const trimmed = value.trim().replaceAll(',', '')
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null
  const [whole, fraction = ''] = trimmed.split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(minor) ? minor : null
}
