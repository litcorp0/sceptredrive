import type { DesktopApi } from '../shared/ipc'

declare global {
  interface Window {
    /** Exposed by the preload bridge; absent in a plain browser. */
    sceptreDrive?: DesktopApi
  }
}
