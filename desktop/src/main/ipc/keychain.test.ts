import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createKeychain, KeychainError, type SafeStorageLike } from './keychain'

/** Deterministic fake: XORs bytes so the ciphertext never contains the plaintext. */
function fakeSafeStorage(options?: { available?: boolean; backend?: string }): SafeStorageLike {
  const available = options?.available ?? true
  const key = 0x5a
  return {
    isAsyncEncryptionAvailable: async () => available,
    encryptStringAsync: async (plainText: string) =>
      Buffer.from([...Buffer.from(plainText, 'utf8')].map((byte) => byte ^ key)),
    decryptStringAsync: async (encrypted: Buffer) => ({
      result: Buffer.from([...encrypted].map((byte) => byte ^ key)).toString('utf8'),
      shouldReEncrypt: false,
    }),
    getSelectedStorageBackend: () => options?.backend ?? 'gnome_libsecret',
  }
}

describe('createKeychain', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sceptre-drive-keychain-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips a secret', async () => {
    const keychain = createKeychain({ userDataDir: dir, storage: fakeSafeStorage() })

    await keychain.set('deviceToken', 'token-abc-123')
    expect(await keychain.get('deviceToken')).toBe('token-abc-123')
    await keychain.delete('deviceToken')
    expect(await keychain.get('deviceToken')).toBeNull()
  })

  it('writes ciphertext with owner-only permissions', async () => {
    const keychain = createKeychain({ userDataDir: dir, storage: fakeSafeStorage() })
    await keychain.set('deviceToken', 'super-secret-token')

    const filePath = path.join(dir, 'secrets.json')
    const raw = fs.readFileSync(filePath, 'utf8')
    expect(raw).not.toContain('super-secret-token')
    expect(raw).toContain('cipher')
    expect(fs.statSync(filePath).mode & 0o777).toBe(0o600)
  })

  it('keeps unrelated secrets when one is deleted', async () => {
    const keychain = createKeychain({ userDataDir: dir, storage: fakeSafeStorage() })
    await keychain.set('deviceToken', 'token')
    await keychain.set('powersyncDbKey', 'dbkey')

    await keychain.delete('deviceToken')

    expect(await keychain.get('deviceToken')).toBeNull()
    expect(await keychain.get('powersyncDbKey')).toBe('dbkey')
  })

  it('fails closed when OS encryption is unavailable', async () => {
    const keychain = createKeychain({
      userDataDir: dir,
      storage: fakeSafeStorage({ available: false }),
    })

    await expect(keychain.set('deviceToken', 'token')).rejects.toBeInstanceOf(KeychainError)
    await expect(keychain.get('deviceToken')).rejects.toBeInstanceOf(KeychainError)
    expect(fs.existsSync(path.join(dir, 'secrets.json'))).toBe(false)
  })

  it('never returns plaintext for an unreadable entry', async () => {
    const keychain = createKeychain({ userDataDir: dir, storage: fakeSafeStorage() })
    await keychain.set('deviceToken', 'token')
    fs.writeFileSync(
      path.join(dir, 'secrets.json'),
      JSON.stringify({ deviceToken: { v: 1, cipher: 'AAAA' } }),
    )

    const broken: SafeStorageLike = {
      ...fakeSafeStorage(),
      decryptStringAsync: async () => {
        throw new Error('key rotated')
      },
    }
    const withBrokenKey = createKeychain({ userDataDir: dir, storage: broken })

    await expect(withBrokenKey.get('deviceToken')).rejects.toThrow(/re-enrol/)
  })

  it('re-encrypts after an OS key rotation', async () => {
    let writes = 0
    const rotating: SafeStorageLike = {
      ...fakeSafeStorage(),
      encryptStringAsync: async (plainText: string) => {
        writes += 1
        const key = writes === 1 ? 0x11 : 0x22
        return Buffer.from([...Buffer.from(plainText, 'utf8')].map((byte) => byte ^ key))
      },
      decryptStringAsync: async (encrypted: Buffer) => ({
        result: Buffer.from([...encrypted].map((byte) => byte ^ 0x11)).toString('utf8'),
        shouldReEncrypt: true,
      }),
    }
    const keychain = createKeychain({ userDataDir: dir, storage: rotating })
    await keychain.set('deviceToken', 'rotate-me')

    expect(await keychain.get('deviceToken')).toBe('rotate-me')
    expect(writes).toBe(2)
  })

  it('reports whether storage is OS-backed or degraded', async () => {
    const osBacked = createKeychain({ userDataDir: dir, storage: fakeSafeStorage() })
    expect(await osBacked.status()).toEqual({
      available: true,
      level: 'os',
      backend: 'gnome_libsecret',
    })

    const basic = createKeychain({
      userDataDir: dir,
      storage: fakeSafeStorage({ backend: 'basic_text' }),
    })
    expect((await basic.status()).level).toBe('basic')

    const unavailable = createKeychain({
      userDataDir: dir,
      storage: fakeSafeStorage({ available: false }),
    })
    expect(await unavailable.status()).toMatchObject({ available: false, level: 'unavailable' })
  })
})
