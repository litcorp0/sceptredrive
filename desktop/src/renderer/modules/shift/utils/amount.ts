import { formatGhs, parseGhsToMinor } from '@/lib/format'

/**
 * What is wrong with a typed amount, if anything.
 *
 * Two rules this exists to keep:
 *
 * - **A half-typed amount is not a wrong one.** `parseGhsToMinor('200.')` is `null`, because a
 *   trailing point is not a finished number — but flashing "Enter an amount like 200.00" while
 *   the cashier is between keystrokes teaches them to distrust the field. A trailing point and an
 *   empty field are both *incomplete*, and incomplete is silent.
 * - **A wrong amount is explained where it was typed.** A disabled button with no message is the
 *   worst of both worlds: the operator cannot act and cannot see why.
 *
 * `null` means "nothing to say yet". The submit handler still refuses an incomplete value; this
 * only decides whether the field has a complaint to show.
 */
export function amountProblem(value: string, minimumMinor = 0): string | null {
  const trimmed = value.trim().replaceAll(',', '')
  if (trimmed === '' || /^\d+\.$/.test(trimmed)) return null

  const minor = parseGhsToMinor(value)
  if (minor === null) return 'Enter an amount like 200.00'
  if (minor < minimumMinor) return `Enter at least ${formatGhs(minimumMinor)}`
  return null
}
