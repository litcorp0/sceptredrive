import type { AppInfo, DesktopApi, DesktopErrorCode, IpcResult, SecretKey } from '../../shared/ipc'
import type {
  DrawerRequest,
  PrintEncoding,
  PrinterTarget,
  PrintRequest,
} from '../../shared/printing'

/**
 * Renderer-side wrapper around `window.gikautos`.
 *
 * - Throws `DesktopUnavailableError` when the preload bridge is missing (web
 *   preview, plain `vite dev`, unit tests), so callers can degrade instead of
 *   crashing on `undefined`.
 * - Unwraps `IpcResult` into values or a typed `DesktopApiError`.
 */

export class DesktopUnavailableError extends Error {
  constructor() {
    super('The desktop bridge is not available in this environment')
    this.name = 'DesktopUnavailableError'
  }
}

export class DesktopApiError extends Error {
  readonly code: DesktopErrorCode

  constructor(code: DesktopErrorCode, message: string) {
    super(message)
    this.name = 'DesktopApiError'
    this.code = code
  }
}

export function getDesktopBridge(): DesktopApi {
  const bridge = globalThis.window?.gikautos
  if (!bridge) throw new DesktopUnavailableError()
  return bridge
}

export function isDesktopAvailable(): boolean {
  return Boolean(globalThis.window?.gikautos)
}

async function unwrap<T>(result: Promise<IpcResult<T>>): Promise<T> {
  const settled = await result
  if (!settled.ok) {
    throw new DesktopApiError(settled.error.code, settled.error.message)
  }
  return settled.data
}

export const desktopApi = {
  getAppInfo(): Promise<AppInfo> {
    return unwrap(getDesktopBridge().app.getInfo())
  },

  async getSecret(key: SecretKey): Promise<string | null> {
    return unwrap(getDesktopBridge().secure.get(key))
  },

  async setSecret(key: SecretKey, value: string): Promise<void> {
    await unwrap(getDesktopBridge().secure.set(key, value))
  },

  async deleteSecret(key: SecretKey): Promise<void> {
    await unwrap(getDesktopBridge().secure.delete(key))
  },

  async hashPin(pin: string, salt: string): Promise<string> {
    return unwrap(getDesktopBridge().pin.hash(pin, salt))
  },

  async verifyPin(verifier: string, pin: string, salt: string): Promise<boolean> {
    return unwrap(getDesktopBridge().pin.verify(verifier, pin, salt))
  },

  async listPrinters() {
    return unwrap(getDesktopBridge().printer.list())
  },

  async printReceipt(request: PrintRequest) {
    return unwrap(getDesktopBridge().printer.print(request))
  },

  async openDrawer(request: DrawerRequest) {
    return unwrap(getDesktopBridge().printer.openDrawer(request))
  },

  async testPrint(request: { target: PrinterTarget; encoding: PrintEncoding }) {
    return unwrap(getDesktopBridge().printer.test(request))
  },
}
