import type { BranchType } from './roles.ts'

const COMBINING_MARKS = /[\u0300-\u036f]/g

export interface SuggestBranchCodeInput {
  city: string
  area?: string
  type: BranchType
  /** Codes already in use, used to avoid collisions in the suggestion. */
  existingCodes?: readonly string[]
}

export interface BranchCodeSuggestion {
  code: string
  /** True when the suggestion had to add a numeric suffix to avoid a collision. */
  adjusted: boolean
}

function tokenize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
}

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U'])

/**
 * Shortens a place name to three readable letters:
 * - short names stay as they are (Adum -> ADU)
 * - names with digits use the first three letters (Zone 4 -> ZON)
 * - names starting with a vowel keep the vowel plus two consonants (Adum -> ADM)
 * - other names use the first, second, and last consonant (Spintex -> SPX, Tema -> TEM)
 */
function abbreviate(token: string): string {
  if (token.length <= 3) return token
  if (/\d/.test(token)) return token.slice(0, 3)

  const consonants = [...token].filter((char) => !VOWELS.has(char))
  const first = token[0] ?? ''

  if (VOWELS.has(first) && consonants.length >= 2) {
    return `${first}${consonants[0]}${consonants[1]}`
  }
  if (consonants.length >= 3) {
    return `${consonants[0]}${consonants[1]}${consonants[consonants.length - 1]}`
  }
  return token.slice(0, 3)
}

function nextFree(base: string, existing: ReadonlySet<string>): BranchCodeSuggestion {
  if (!existing.has(base)) return { code: base, adjusted: false }
  let suffix = 2
  while (existing.has(`${base}-${suffix}`)) suffix += 1
  return { code: `${base}-${suffix}`, adjusted: true }
}

/** `ACC-WH1`, `ACC-WH2`, or `ACC-R1`, `ACC-R2` when the area is absent. */
function nextSequence(
  city: string,
  marker: string,
  existing: ReadonlySet<string>,
): BranchCodeSuggestion {
  let sequence = 1
  while (existing.has(`${city}-${marker}${sequence}`)) sequence += 1
  return { code: `${city}-${marker}${sequence}`, adjusted: sequence > 1 }
}

/**
 * Suggests a short, location-based branch code:
 * - Retail with an area: city (3 letters) + area (3 letters), e.g. Accra/Spintex -> ACC-SPX
 * - Retail without an area: city (3 letters) + R + sequence, e.g. Tamale -> TAM-R1
 * - Warehouse: city (3 letters) + WH + sequence, e.g. Accra -> ACC-WH1
 *
 * The suggestion is only a preview in the console: the server generates the
 * authoritative code on create, and uniqueness is enforced by the database.
 */
export function suggestBranchCode(input: SuggestBranchCodeInput): BranchCodeSuggestion {
  const city = tokenize(input.city).slice(0, 3) || 'BRN'
  const existing = new Set((input.existingCodes ?? []).map(normalizeBranchCode))

  if (input.type === 'WAREHOUSE') {
    return nextSequence(city, 'WH', existing)
  }

  if (!input.area) {
    return nextSequence(city, 'R', existing)
  }

  const area = abbreviate(tokenize(input.area))
  if (!area) return nextSequence(city, 'R', existing)
  return nextFree(`${city}-${area}`, existing)
}

/** 'ACC-SPX', 'ACC-WH1', 'ACC-SPX-2', or a bare 'ACC' fallback. */
const BRANCH_CODE_PATTERN = /^[A-Z0-9]{2,4}(-[A-Z0-9]{1,4}){0,2}$/

export function normalizeBranchCode(code: string): string {
  return code.trim().toUpperCase()
}

export function isValidBranchCode(code: string): boolean {
  return BRANCH_CODE_PATTERN.test(normalizeBranchCode(code))
}
