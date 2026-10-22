import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { APP_ORIGIN } from './paths'
import { devToolsEnabled } from './security'

export type MainWindowOptions = {
  /** Absolute path to the built preload bundle (`.vite/build/preload.cjs`). */
  preloadPath: string
  /** Vite dev-server URL in development; undefined in a packaged build. */
  devServerUrl?: string
}

let mainWindow: BrowserWindow | null = null

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    backgroundColor: '#ffffff',
    title: 'GikAutos POS',
    autoHideMenuBar: true,
    webPreferences: {
      preload: options.preloadPath,
      // Node stays out of the renderer entirely; everything privileged goes
      // through the whitelisted preload bridge.
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      sandbox: true,
      webviewTag: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      spellcheck: false,
      devTools: devToolsEnabled(),
    },
  })

  window.once('ready-to-show', () => {
    window.show()
  })

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
  })

  if (options.devServerUrl) {
    void window.loadURL(options.devServerUrl)
  } else {
    void window.loadURL(`${APP_ORIGIN}/index.html`)
  }

  mainWindow = window
  return window
}

/** Origins the main window may navigate to. */
export function navigationOrigins(options: MainWindowOptions): string[] {
  if (options.devServerUrl) {
    return [new URL(options.devServerUrl).origin]
  }
  return [APP_ORIGIN]
}

export function preloadPathFor(buildDir: string): string {
  return path.join(buildDir, 'preload.cjs')
}

export function isPackaged(): boolean {
  return app.isPackaged
}
