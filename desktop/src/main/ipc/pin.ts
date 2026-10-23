import { hash, type Options, verify } from '@node-rs/argon2'

/**
 * PIN hashing runs here, in the main process, so the renderer never holds a
 * password-hashing key and a compromised renderer cannot read the verifier of
 * another staff member without going through IPC.
 *
 * The profile matches the API's password profile (Argon2id, 64 MiB, t=3, p=4).
 * Argon2's `secret` (pepper) is the device salt: it is stored separately from
 * the verifier, so a copied verifier alone cannot be attacked offline.
 */

const ARGON2ID = 2
const SALT_BYTES = 16

export const PIN_ARGON2_OPTIONS: Options = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  outputLen: 32,
  algorithm: ARGON2ID,
}

export class PinCryptoError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PinCryptoError'
  }
}

function decodeSalt(salt: string): Buffer {
  const bytes = Buffer.from(salt, 'base64')
  if (bytes.length !== SALT_BYTES) {
    throw new PinCryptoError('PIN salt must be 16 base64-encoded bytes')
  }
  return bytes
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  return hash(pin, { ...PIN_ARGON2_OPTIONS, secret: decodeSalt(salt) })
}

/** A malformed verifier is a failed verification, never an exception. */
export async function verifyPin(verifier: string, pin: string, salt: string): Promise<boolean> {
  try {
    return await verify(verifier, pin, { secret: decodeSalt(salt) })
  } catch {
    return false
  }
}
