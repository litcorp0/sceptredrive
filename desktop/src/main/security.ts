import { app, session, type WebContents } from 'electron'

/**
 * Process-wide renderer hardening.
 *
 * Rules (Electron security checklist):
 * - no new windows, no embedded webviews;
 * - navigation stays on the app origin (or the Vite dev server in development);
 * - every permission request (camera, microphone, geolocation, notifications,
 *   clipboard, MIDI, HID, serial, USB …) is denied;
 * - DevTools are unavailable in a packaged build.
 */

export type NavigationPolicy = {
  /** Origins the main window may navigate to (app origin, plus the dev server in dev). */
  allowedOrigins: readonly string[]
}

export function isAllowedNavigation(url: string, policy: NavigationPolicy): boolean {
  return policy.allowedOrigins.some((origin) => url.startsWith(origin))
}

export function hardenSession(): void {
  const defaultSession = session.defaultSession
  defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => {
    callback(false)
  })
  defaultSession.setPermissionCheckHandler(() => false)
  defaultSession.setDevicePermissionHandler(() => false)
}

export function applyWebContentsSecurity(contents: WebContents, policy: NavigationPolicy): void {
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))

  contents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, policy)) {
      event.preventDefault()
    }
  })

  contents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url, policy)) {
      event.preventDefault()
    }
  })

  contents.on('will-attach-webview', (event) => {
    event.preventDefault()
  })
}

export function installGlobalSecurityHandlers(policy: NavigationPolicy): void {
  app.on('web-contents-created', (_event, contents) => {
    applyWebContentsSecurity(contents, policy)
  })
}

export function devToolsEnabled(): boolean {
  return !app.isPackaged
}

/**
 * An IPC handler must only ever run for the app's own renderer.
 *
 * `event.senderFrame.url` is the frame that sent the message; checking it against
 * the allowed origins keeps a compromised or navigated frame from reaching
 * privileged main-process code. Returns false (fail closed) when the frame is
 * gone.
 */
export function isTrustedIpcSender(
  event: { senderFrame: { url: string } | null },
  policy: NavigationPolicy,
): boolean {
  const url = event.senderFrame?.url
  if (!url) return false
  return isAllowedNavigation(url, policy)
}
