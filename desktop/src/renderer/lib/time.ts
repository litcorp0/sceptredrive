/** Ghana has no DST: Africa/Accra is UTC year-round, so the UTC date is local. */
export function accraDay(now = new Date()): string {
  return now.toISOString().slice(0, 10).replaceAll('-', '')
}
