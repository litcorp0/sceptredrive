/**
 * What a locked-out cashier is told.
 *
 * The old copy named only the attempt count, so the person at the counter could not tell
 * whether waiting would help or whether a manager was the only way forward. The lock has a
 * deadline (`lockedUntil`), so the sentence names it.
 *
 * Kept pure and out of the page: it is arithmetic over a timestamp and a sentence, which is
 * cheaper to test than to eyeball in a JSX branch.
 */
export function lockoutMessage(lockedUntil: string | null, now: number = Date.now()): string {
  const until = lockedUntil ? Date.parse(lockedUntil) : Number.NaN
  if (Number.isNaN(until) || until <= now) {
    return 'Too many wrong PINs. A manager can unlock this terminal.'
  }
  const minutes = Math.ceil((until - now) / 60_000)
  return `Too many wrong PINs. Try again in ${minutes} minute${
    minutes === 1 ? '' : 's'
  }, or ask a manager to unlock this terminal.`
}
