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

import type {
  DrawerPin,
  DrawerRequest,
  PrintEncoding,
  PrinterInfo,
  PrinterTarget,
  PrintJob,
  PrintOutcome,
  PrintRequest,
} from './printing'

export type {
  DrawerPin,
  DrawerRequest,
  PrintEncoding,
  PrintJob,
  PrinterInfo,
  PrintOutcome,
  PrintRequest,
  PrinterTarget,
}

export const IPC_CHANNELS = {
  appGetInfo: 'app:get-info',
  secureGet: 'secure:get',
  secureSet: 'secure:set',
  secureDelete: 'secure:delete',
  pinHash: 'pin:hash',
  pinVerify: 'pin:verify',
  printerList: 'printer:list',
  printerPrint: 'printer:print',
  printerOpenDrawer: 'printer:open-drawer',
  printerTest: 'printer:test',
  checkoutOpen: 'payments:checkout:open',
  checkoutClose: 'payments:checkout:close',
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

/**
 * The checkout window's answer. A refusal is data, not an exception: a
 * `UNTRUSTED_URL` is a server (or a compromised renderer) trying to put a page
 * we do not own on the till, and the cashier must be able to carry on with cash.
 */
export type CheckoutOpenResult =
  | { ok: true }
  | { ok: false; reason: 'UNTRUSTED_URL' | 'NO_PARENT' | 'OPEN_FAILED' }

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
  /**
   * Only true when the operator started the app with `POS_DIAGNOSTICS=1`.
   * Hardware/print diagnostics can open the drawer, so they are not a normal
   * cashier-reachable screen in production.
   */
  diagnosticsEnabled: boolean
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
  /**
   * Argon2id PIN hashing runs in the main process. The renderer only sees the
   * verifier, never a key or a hash of the server credential.
   */
  pin: {
    /** `salt` is base64 of 16 random bytes; it is used as the Argon2 pepper. */
    hash(pin: string, salt: string): Promise<IpcResult<string>>
    verify(verifier: string, pin: string, salt: string): Promise<IpcResult<boolean>>
  }
  /**
   * ESC/POS printing. The renderer sends a bounded, pre-formatted job; the
   * main process owns the native adapter. Printer trouble is returned as a
   * `PrintOutcome` (never thrown) so a sale is never blocked (D28).
   */
  printer: {
    list(): Promise<IpcResult<PrinterInfo[]>>
    print(request: PrintRequest): Promise<IpcResult<PrintOutcome>>
    openDrawer(request: DrawerRequest): Promise<IpcResult<PrintOutcome>>
    test(request: {
      target: PrinterTarget
      encoding: PrintEncoding
    }): Promise<IpcResult<PrintOutcome>>
  }
  /**
   * Paystack Checkout for the card tender. The window is created in the main
   * process with no preload; the renderer only ever opens and closes it. The
   * result of the payment arrives through the server, never from this bridge.
   *
   * Optional because a preload built before this feature has no `payments`
   * branch: the card tender must then say the window is unavailable instead of
   * crashing the till.
   */
  payments?: {
    checkout: {
      open(url: string): Promise<IpcResult<CheckoutOpenResult>>
      close(): Promise<IpcResult<null>>
    }
  }
}

/** Upper bound for a single stored secret (tokens and keys are far smaller). */
export const MAX_SECRET_LENGTH = 8_192
