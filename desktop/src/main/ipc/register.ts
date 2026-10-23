import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { z } from 'zod'
import {
  type DesktopErrorCode,
  IPC_CHANNELS,
  type IpcResult,
  MAX_SECRET_LENGTH,
  SECRET_KEYS,
} from '../../shared/ipc'
import { isTrustedIpcSender, type NavigationPolicy } from '../security'
import { getAppInfo } from './app-info'
import { type Keychain, KeychainError } from './keychain'
import { hashPin, PinCryptoError, verifyPin } from './pin'

const secretKeySchema = z.enum(SECRET_KEYS)
const secretValueSchema = z.string().min(1).max(MAX_SECRET_LENGTH)
const pinSchema = z.string().regex(/^\d{4,6}$/, 'A PIN is 4–6 digits')
const pinSaltSchema = z
  .string()
  .min(16)
  .max(64)
  .refine((salt) => Buffer.from(salt, 'base64').length === 16, 'Invalid PIN salt')
const pinVerifierSchema = z.string().min(20).max(512)

function failure(code: DesktopErrorCode, message: string): IpcResult<never> {
  return { ok: false, error: { code, message } }
}

function toFailure(error: unknown): IpcResult<never> {
  if (error instanceof z.ZodError) {
    return failure('INVALID_INPUT', 'Invalid request from the renderer')
  }
  if (error instanceof KeychainError) {
    return failure(error.code, error.message)
  }
  if (error instanceof PinCryptoError) {
    return failure('INVALID_INPUT', error.message)
  }
  return failure('INTERNAL', 'Unexpected failure in the main process')
}

export type IpcRegistrationOptions = {
  keychain: Keychain
  policy: NavigationPolicy
  /** Returns the trusted main window, if it is still open. */
  mainWindow: () => BrowserWindow | null
  log?: (message: string) => void
}

export function registerIpcHandlers(options: IpcRegistrationOptions): void {
  const log = options.log ?? (() => {})

  function handle<Args extends unknown[], T>(
    channel: string,
    handler: (...args: Args) => Promise<T>,
  ): void {
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<IpcResult<T>> => {
      if (!isTrustedIpcSender(event, options.policy)) {
        log(`rejected IPC on ${channel}: untrusted frame`)
        return failure('UNTRUSTED_SENDER', 'Request did not come from the app renderer')
      }

      const trustedWindow = options.mainWindow()
      if (!trustedWindow || trustedWindow.webContents.id !== event.sender.id) {
        log(`rejected IPC on ${channel}: sender is not the main window`)
        return failure('UNTRUSTED_SENDER', 'Request did not come from the main window')
      }

      try {
        return { ok: true, data: await handler(...(args as Args)) }
      } catch (error) {
        // Never log secret values: only the channel and the error class.
        const result = toFailure(error)
        const code = result.ok ? 'INTERNAL' : result.error.code
        log(`IPC ${channel} failed: ${code}`)
        return result
      }
    })
  }

  handle(IPC_CHANNELS.appGetInfo, () => getAppInfo(options.keychain))

  handle(IPC_CHANNELS.secureGet, async (rawKey: unknown) => {
    const key = secretKeySchema.parse(rawKey)
    return options.keychain.get(key)
  })

  handle(IPC_CHANNELS.secureSet, async (rawKey: unknown, rawValue: unknown) => {
    const key = secretKeySchema.parse(rawKey)
    const value = secretValueSchema.parse(rawValue)
    await options.keychain.set(key, value)
    return null
  })

  handle(IPC_CHANNELS.secureDelete, async (rawKey: unknown) => {
    const key = secretKeySchema.parse(rawKey)
    await options.keychain.delete(key)
    return null
  })

  handle(IPC_CHANNELS.pinHash, async (rawPin: unknown, rawSalt: unknown) => {
    const pin = pinSchema.parse(rawPin)
    const salt = pinSaltSchema.parse(rawSalt)
    return hashPin(pin, salt)
  })

  handle(
    IPC_CHANNELS.pinVerify,
    async (rawVerifier: unknown, rawPin: unknown, rawSalt: unknown) => {
      const verifier = pinVerifierSchema.parse(rawVerifier)
      const pin = pinSchema.parse(rawPin)
      const salt = pinSaltSchema.parse(rawSalt)
      return verifyPin(verifier, pin, salt)
    },
  )
}

/** Test seam: removes every handler registered above. */
export function removeIpcHandlers(): void {
  for (const channel of Object.values(IPC_CHANNELS)) {
    ipcMain.removeHandler(channel)
  }
}
