import { formatGhs } from '@/lib/format'

/**
 * The shift variance in words.
 *
 * The close dialog used to show the number alone: `-GHS 4.00` in red beside `GHS 4.00` in
 * green, with colour doing the work of saying which one was bad. Colour is never the only
 * signal here — "Short" and "Over" say it in the operator's words (WCAG 2.2 SC 1.4.1), on a
 * monochrome counter screen as much as on a colour one.
 */
export function varianceWords(varianceMinor: number): string {
  if (varianceMinor === 0) return 'Exact'
  return varianceMinor > 0
    ? `Over ${formatGhs(varianceMinor)}`
    : `Short ${formatGhs(-varianceMinor)}`
}
