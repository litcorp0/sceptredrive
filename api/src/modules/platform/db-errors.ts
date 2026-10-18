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

function pgField(error: unknown, field: 'constraint' | 'message'): string | null {
  const read = (value: unknown): string | null => {
    if (typeof value !== 'object' || value === null) return null
    const record = value as Record<string, unknown>
    return typeof record[field] === 'string' ? record[field] : null
  }

  const direct = read(error)
  if (direct) return direct
  if (typeof error === 'object' && error !== null && 'cause' in error) {
    return read((error as { cause?: unknown }).cause)
  }
  return null
}

/** Name of the index or constraint that a unique violation tripped, if known. */
export function uniqueViolationConstraint(error: unknown): string | null {
  return pgField(error, 'constraint') ?? pgField(error, 'message')
}

export function isForeignKeyViolation(error: unknown): boolean {
  return pgCode(error) === '23503'
}
