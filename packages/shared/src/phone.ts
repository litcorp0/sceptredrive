import parsePhoneNumberFromString from 'libphonenumber-js'

/**
 * Normalizes a Ghana phone number to E.164 (`+233…`), accepting national
 * (`024 123 4567`), international (`233…`), and `+233…` input. Returns null
 * when the value is not a valid Ghana number.
 */
export function normalizeGhanaPhone(input: string): string | null {
  const trimmed = input.trim()
  if (trimmed.length === 0) return null

  const parsed = parsePhoneNumberFromString(trimmed, 'GH')
  if (!parsed || parsed.country !== 'GH' || !parsed.isValid()) return null

  return parsed.number
}

/**
 * Formats an E.164 Ghana number for display (national format, e.g.
 * `024 123 4567`); returns the raw value when it cannot be parsed.
 */
export function formatGhanaPhone(value: string): string {
  const parsed = parsePhoneNumberFromString(value, 'GH')
  return parsed ? parsed.formatNational() : value
}
