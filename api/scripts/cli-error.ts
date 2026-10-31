/**
 * The whole story of a CLI failure, not just drizzle's wrapper.
 *
 * Drizzle throws `DrizzleQueryError` whose `message` is "Failed query: …" and whose
 * `cause` is the Postgres error ("relation \"user\" does not exist"). Printing only
 * `message` sends an operator looking at the SQL when the answer is the database, the
 * role or the branch they connected to.
 */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)

  const parts: string[] = []
  let current: unknown = error
  const seen = new Set<unknown>()
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current)
    // The repeated "Failed query" text adds nothing after the query itself.
    if (current.message && !parts.includes(current.message)) parts.push(current.message)
    current = (current as { cause?: unknown }).cause
  }
  return parts.join(' — ')
}
