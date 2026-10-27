/**
 * The feature-flag registry (P14-D41).
 *
 * A flag is a typed boolean setting, not a second store: the keys live in
 * `SETTING_DEFINITIONS` and are read, written and audited by the settings path
 * that already exists. Defaults are on because this phase ships these features;
 * a flag exists to turn one off without a deploy, not to hide a half-built
 * screen.
 */

export const FLAG_KEYS = [
  'flag.supplierTransfers',
  'flag.evatSubmission',
  'flag.posConflictResolution',
] as const

export type FlagKey = (typeof FLAG_KEYS)[number]

const FLAG_KEY_SET: ReadonlySet<string> = new Set(FLAG_KEYS)

export const FLAG_DEFAULTS: Record<FlagKey, boolean> = {
  'flag.supplierTransfers': true,
  'flag.evatSubmission': true,
  'flag.posConflictResolution': true,
}

export const FLAG_DESCRIPTIONS: Record<FlagKey, string> = {
  'flag.supplierTransfers': 'Pay suppliers with a Paystack transfer instead of a manual payment.',
  'flag.evatSubmission': 'Submit invoices and refunds to GRA for an E-VAT certificate.',
  'flag.posConflictResolution': 'Show the POS conflict queue and let managers resolve conflicts.',
}

export function isFlagKey(key: string): key is FlagKey {
  return FLAG_KEY_SET.has(key)
}
