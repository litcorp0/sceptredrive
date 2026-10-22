import fs from 'node:fs'
import path from 'node:path'
import type { SecretKey, SecureStorageStatus } from '../../shared/ipc'

/**
 * Encrypted secret storage for the POS.
 *
 * Every value is encrypted with Electron's **async** `safeStorage` API (the sync
 * API is deprecated in Electron 45 and removed in 46) and written to
 * `userData/secrets.json` with mode `0600`:
 *
 *   { "deviceToken": { "v": 1, "cipher": "base64…" } }
 *
 * There is no plaintext fallback. When OS encryption is unavailable every
 * operation fails with `KEYCHAIN_UNAVAILABLE`, so device enrolment and sync stop
 * rather than storing a bearer token in the clear.
 */

export type SafeStorageLike = {
  isAsyncEncryptionAvailable(): Promise<boolean>
  encryptStringAsync(plainText: string): Promise<Buffer>
  decryptStringAsync(encrypted: Buffer): Promise<{ result: string; shouldReEncrypt: boolean }>
  getSelectedStorageBackend?(): string
}

export class KeychainError extends Error {
  readonly code: 'KEYCHAIN_UNAVAILABLE' | 'INTERNAL'

  constructor(code: 'KEYCHAIN_UNAVAILABLE' | 'INTERNAL', message: string) {
    super(message)
    this.name = 'KeychainError'
    this.code = code
  }
}

export type Keychain = {
  status(): Promise<SecureStorageStatus>
  get(key: SecretKey): Promise<string | null>
  set(key: SecretKey, value: string): Promise<void>
  delete(key: SecretKey): Promise<void>
}

type SecretFile = Record<string, { v: 1; cipher: string }>

export type KeychainOptions = {
  userDataDir: string
  storage: SafeStorageLike
  /** Warns on degraded storage without ever logging values. */
  log?: (message: string) => void
}

export const SECRETS_FILE_NAME = 'secrets.json'
const SECRETS_FILE_MODE = 0o600

export function createKeychain(options: KeychainOptions): Keychain {
  const filePath = path.join(options.userDataDir, SECRETS_FILE_NAME)
  const log = options.log ?? (() => {})

  async function requireEncryption(): Promise<boolean> {
    let available = false
    try {
      available = await options.storage.isAsyncEncryptionAvailable()
    } catch {
      available = false
    }
    if (!available) {
      throw new KeychainError(
        'KEYCHAIN_UNAVAILABLE',
        'OS encryption is unavailable; refusing to store secrets in plaintext',
      )
    }
    return true
  }

  function readFile(): SecretFile {
    if (!fs.existsSync(filePath)) return {}
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
      return parsed as SecretFile
    } catch {
      throw new KeychainError('INTERNAL', 'secrets.json is unreadable')
    }
  }

  function writeFile(contents: SecretFile): void {
    const directory = path.dirname(filePath)
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    const tempPath = `${filePath}.tmp`
    fs.writeFileSync(tempPath, JSON.stringify(contents), { mode: SECRETS_FILE_MODE })
    fs.renameSync(tempPath, filePath)
    try {
      fs.chmodSync(filePath, SECRETS_FILE_MODE)
    } catch {
      log('could not enforce 0600 on secrets.json')
    }
  }

  return {
    async status() {
      let available = false
      try {
        available = await options.storage.isAsyncEncryptionAvailable()
      } catch {
        available = false
      }
      const backend = options.storage.getSelectedStorageBackend?.() ?? null
      if (!available) {
        return { available: false, level: 'unavailable', backend }
      }
      // `basic_text` means Linux fell back to a hardcoded password: the file is
      // encrypted but effectively obfuscated, so report it honestly.
      const level = backend === 'basic_text' ? 'basic' : 'os'
      return { available: true, level, backend }
    },

    async get(key) {
      await requireEncryption()
      const entry = readFile()[key]
      if (!entry) return null

      try {
        const decrypted = await options.storage.decryptStringAsync(
          Buffer.from(entry.cipher, 'base64'),
        )
        if (decrypted.shouldReEncrypt) {
          const reEncrypted = await options.storage.encryptStringAsync(decrypted.result)
          writeFile({
            ...readFile(),
            [key]: { v: 1, cipher: reEncrypted.toString('base64') },
          })
          log(`re-encrypted secret after key rotation: ${key}`)
        }
        return decrypted.result
      } catch {
        // A rotated OS key can make old ciphertext unreadable. Drop nothing and
        // let the caller re-enrol; never surface the ciphertext or the error text.
        throw new KeychainError(
          'INTERNAL',
          'stored secret could not be decrypted; re-enrol the device',
        )
      }
    },

    async set(key, value) {
      await requireEncryption()
      const encrypted = await options.storage.encryptStringAsync(value)
      writeFile({ ...readFile(), [key]: { v: 1, cipher: encrypted.toString('base64') } })
      log(`stored secret: ${key}`)
    },

    async delete(key) {
      if (!fs.existsSync(filePath)) return
      const contents = readFile()
      if (!(key in contents)) return
      delete contents[key]
      writeFile(contents)
      log(`deleted secret: ${key}`)
    },
  }
}
