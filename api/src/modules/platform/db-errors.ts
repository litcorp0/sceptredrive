function pgCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null
  if ('code' in error && typeof error.code === 'string') return error.code
  const cause = 'cause' in error ? error.cause : null
  if (typeof cause === 'object' && cause !== null && 'code' in cause) {
    return typeof cause.code === 'string' ? cause.code : null
  }
  return null
}

export function isUniqueViolation(error: unknown): boolean {
  return pgCode(error) === '23505'
}

export function isForeignKeyViolation(error: unknown): boolean {
  return pgCode(error) === '23503'
}
