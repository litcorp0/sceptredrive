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
