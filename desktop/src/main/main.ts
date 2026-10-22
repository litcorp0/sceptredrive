import { app, BrowserWindow, Menu, safeStorage } from 'electron'
import started from 'electron-squirrel-startup'
import { loadRuntimeConfig, originOf, type RuntimeConfig } from './config'
import { buildContentSecurityPolicy, isAllowedConnectOrigin } from './csp'
import { createKeychain } from './ipc/keychain'
import { registerIpcHandlers } from './ipc/register'
import { registerAppScheme, rendererRootDir, serveRenderer } from './protocol'
import { hardenSession, installGlobalSecurityHandlers } from './security'
import { createMainWindow, getMainWindow, navigationOrigins, preloadPathFor } from './windows'

// Squirrel (Windows) runs the app with special flags on install/uninstall; a
// quit here keeps those runs from opening a window.
if (started) {
  app.quit()
}

// Must run before the app is ready so the scheme can be registered as privileged.
registerAppScheme()

const devServerUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL || undefined
const isDev = Boolean(devServerUrl)

function failClosed(code: string, message: string): never {
  console.error(`[startup] ${code}: ${message}`)
  app.exit(1)
  throw new Error(message)
}

function resolveConfig(): RuntimeConfig {
  try {
    return loadRuntimeConfig(app.getPath('userData'), isDev)
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'CONFIG_INVALID'
    return failClosed(code, error instanceof Error ? error.message : 'Invalid configuration')
  }
}

function assertOriginsAllowed(config: RuntimeConfig): void {
  for (const url of [config.apiBaseUrl, config.powersyncUrl]) {
    if (!isAllowedConnectOrigin(url, { dev: isDev })) {
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
