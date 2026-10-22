/**
 * The contract between the renderer and the main process.
 *
 * Rules:
 * - The renderer never gets a generic `invoke(channel, …)`; every privileged
 *   capability is an explicit method here.
 * - Results are plain objects, never thrown errors: Electron does not preserve
 *   `Error` subclasses across IPC.
 * - Secrets cross the bridge only as opaque strings; key names are an enum so a
 *   compromised renderer cannot read arbitrary files.
 */

export const IPC_CHANNELS = {
  appGetInfo: 'app:get-info',
  secureGet: 'secure:get',
  secureSet: 'secure:set',
  secureDelete: 'secure:delete',
} as const

/** Keys stored encrypted with the OS keychain (async `safeStorage`). */
export const SECRET_KEYS = [
  'deviceToken',
  'deviceId',
  'terminalId',
  'branchId',
  'powersyncDbKey',
  /**
   * Never read by product code. The diagnostics screen writes a random probe
   * here to prove the OS keychain round-trips, then removes it.
   */
  'keychainSelfTest',
] as const

export type SecretKey = (typeof SECRET_KEYS)[number]

export type DesktopErrorCode =
  | 'KEYCHAIN_UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'UNTRUSTED_SENDER'
  | 'SECRET_TOO_LARGE'
  | 'INTERNAL'

export type IpcOk<T> = { ok: true; data: T }
export type IpcErr = { ok: false; error: { code: DesktopErrorCode; message: string } }
export type IpcResult<T> = IpcOk<T> | IpcErr

export type SecureStorageStatus = {
  /** OS-backed encryption is available at all. */
  available: boolean
  /**
   * `os` = DPAPI / Keychain / Secret Service.
   * `basic` = Linux fallback with a hardcoded password (obfuscation only).
   */
  level: 'os' | 'basic' | 'unavailable'
  /** Backend name on Linux (`gnome_libsecret`, `kwallet6`, `basic_text`, …). */
  backend: string | null
}

export type AppInfo = {
  name: string
  version: string
  electron: string
  chrome: string
  platform: string
  arch: string
  isPackaged: boolean
  userDataPath: string
  secureStorage: SecureStorageStatus
}

export type DesktopApi = {
  app: {
    getInfo(): Promise<IpcResult<AppInfo>>
  }
  secure: {
    get(key: SecretKey): Promise<IpcResult<string | null>>
    set(key: SecretKey, value: string): Promise<IpcResult<null>>
    delete(key: SecretKey): Promise<IpcResult<null>>
  }
}

/** Upper bound for a single stored secret (tokens and keys are far smaller). */
export const MAX_SECRET_LENGTH = 8_192
