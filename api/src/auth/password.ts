import { hash, type Options, verify } from '@node-rs/argon2'

const ARGON2ID = 2

/** OWASP-aligned Argon2id parameters: 64 MiB memory, 3 passes, 4 lanes, 32-byte output. */
export const argon2Options: Options = {
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
  outputLen: 32,
  algorithm: ARGON2ID,
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, argon2Options)
}

export function verifyPassword(data: { hash: string; password: string }): Promise<boolean> {
  return verify(data.hash, data.password)
}
