import { app, BrowserWindow, Menu, safeStorage } from 'electron'
import started from 'electron-squirrel-startup'
import {
  allowsLocalOrigins,
  loadRuntimeConfig,
  originOf,
  type RuntimeConfig,
  readAllowLocalApiFlag,
} from './config'
import { buildContentSecurityPolicy, isAllowedConnectOrigin } from './csp'
import { APP_USER_MODEL_ID } from './identity'
import { createKeychain } from './ipc/keychain'
import { registerIpcHandlers } from './ipc/register'
import { createPrinterRuntime } from './printing/printer'
import { registerAppScheme, rendererRootDir, serveRenderer } from './protocol'
import { hardenSession, installGlobalSecurityHandlers } from './security'
import { createMainWindow, getMainWindow, navigationOrigins, preloadPathFor } from './windows'

// Squirrel (Windows) runs the app with special flags on install/uninstall; a
// quit here keeps those runs from opening a window.
if (started) {
  app.quit()
}

/**
 * Windows groups taskbar buttons and routes notifications by App User Model ID.
 * It must match the one Squirrel stamped on the installed shortcut, so set it as
 * early as possible and only where it exists. See `identity.ts`.
 */
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID)
}

// Must run before the app is ready so the scheme can be registered as privileged.
registerAppScheme()

const devServerUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL || undefined
const isDev = Boolean(devServerUrl)
/**
 * Localhost API/PowerSync origins are allowed for the dev server and for an
 * unpackaged build (E2E, local smoke tests) — never for a packaged app, unless
 * the operator opted in at launch with SCEPTRE_ALLOW_LOCAL_API=1.
 */
const allowLocalApi = readAllowLocalApiFlag(process.env)
const allowLocalOrigins = allowsLocalOrigins({
  isDev,
  isPackaged: app.isPackaged,
  allowLocalApi,
})
if (allowLocalApi && app.isPackaged) {
  // Never a token, never a URL: just the fact that the shipped default is overridden.
  console.warn(
    '[security] SCEPTRE_ALLOW_LOCAL_API=1 — this packaged build may talk to a localhost API',
  )
}

function failClosed(code: string, message: string): never {
  console.error(`[startup] ${code}: ${message}`)
  app.exit(1)
  throw new Error(message)
}

function resolveConfig(): RuntimeConfig {
  try {
    return loadRuntimeConfig(app.getPath('userData'), allowLocalOrigins)
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'CONFIG_INVALID'
    return failClosed(code, error instanceof Error ? error.message : 'Invalid configuration')
  }
}

function assertOriginsAllowed(config: RuntimeConfig): void {
  for (const url of [config.apiBaseUrl, config.powersyncUrl]) {
    if (!isAllowedConnectOrigin(url, { allowLocal: allowLocalOrigins })) {
      failClosed('CONFIG_ORIGIN_NOT_ALLOWED', `Refusing to connect to ${originOf(url)}`)
    }
  }
}

void app.whenReady().then(() => {
  if (!isDev) {
    Menu.setApplicationMenu(null)
  }

  const config = resolveConfig()
  assertOriginsAllowed(config)

  const windowOptions = {
    preloadPath: preloadPathFor(__dirname),
    devServerUrl,
  }
  const policy = { allowedOrigins: navigationOrigins(windowOptions) }
  const csp = buildContentSecurityPolicy({
    dev: isDev,
    allowLocalOrigins,
    apiOrigin: originOf(config.apiBaseUrl),
    powersyncOrigin: originOf(config.powersyncUrl),
  })

  hardenSession()
  installGlobalSecurityHandlers(policy)

  const keychain = createKeychain({
    userDataDir: app.getPath('userData'),
    storage: safeStorage,
    // Key names only; never a value.
    log: (message) => console.info(`[keychain] ${message}`),
  })

  registerIpcHandlers({
    keychain,
    policy,
    mainWindow: getMainWindow,
    printing: createPrinterRuntime({
      userDataDir: app.getPath('userData'),
      isPackaged: app.isPackaged,
      // Only the error code is logged; never a receipt line or a customer name.
      log: (message) => console.warn(`[printing] ${message}`),
    }),
    log: (message) => console.warn(`[ipc] ${message}`),
  })

  if (!isDev) {
    serveRenderer(rendererRootDir(__dirname, MAIN_WINDOW_VITE_NAME), csp)
  }

  createMainWindow(windowOptions)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow(windowOptions)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Defence in depth: never let a second instance attach to the same local database.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })
}
