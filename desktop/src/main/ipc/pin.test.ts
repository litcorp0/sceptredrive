import { describe, expect, it } from 'vitest'
import { hashPin, verifyPin } from './pin'

/** 16 zero bytes, base64. */
const SALT = Buffer.alloc(16).toString('base64')
const OTHER_SALT = Buffer.alloc(16, 7).toString('base64')

describe('main-process PIN hashing', () => {
  it('hashes with Argon2id and verifies the same PIN and salt', async () => {
    const verifier = await hashPin('2468', SALT)
    expect(verifier).toMatch(/^\$argon2id\$/)
    expect(verifier).not.toContain('2468')
    expect(await verifyPin(verifier, '2468', SALT)).toBe(true)
  })

  it('rejects a wrong PIN, a wrong device salt, and a malformed verifier', async () => {
    const verifier = await hashPin('2468', SALT)
    expect(await verifyPin(verifier, '2469', SALT)).toBe(false)
    expect(await verifyPin(verifier, '2468', OTHER_SALT)).toBe(false)
    expect(await verifyPin('not-a-verifier', '2468', SALT)).toBe(false)
  })

  it('refuses a salt that is not 16 bytes', async () => {
    await expect(hashPin('2468', Buffer.alloc(8).toString('base64'))).rejects.toThrow(
      /16 base64-encoded bytes/,
    )
  })
})
