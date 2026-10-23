/**
 * UUIDv7 (time-ordered) client ids (D10).
 *
 * The POS mints ids for sales, drafts, and outbox rows. Version 7 keeps them
 * sortable by creation time, which matters offline: several terminals can
 * create rows with no server in the loop, and insertion order should still be
 * meaningful when they eventually sync. `crypto.randomUUID()` would give v4
 * and lose that.
 */

function hex(value: number): string {
  return value.toString(16).padStart(2, '0')
}

/** RFC 9562 UUIDv7: 48-bit big-endian millisecond timestamp, then random. */
export function uuidv7(now = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffffffffffff) {
    throw new RangeError('uuidv7 needs a millisecond timestamp in the 48-bit range')
  }

  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)

  let remaining = now
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = remaining & 0xff
    remaining = Math.floor(remaining / 256)
  }

  // Version 7 in the high nibble of byte 6, RFC 4122 variant in byte 8.
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80

  const octets = Array.from(bytes, hex).join('')
  return [
    octets.slice(0, 8),
    octets.slice(8, 12),
    octets.slice(12, 16),
    octets.slice(16, 20),
    octets.slice(20, 32),
  ].join('-')
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Acceptor for ids that came back from the server or the local database. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}
