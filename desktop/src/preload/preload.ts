import { contextBridge, ipcRenderer } from 'electron'
import { type DesktopApi, IPC_CHANNELS, type SecretKey } from '../shared/ipc'

/**
 * The only bridge between the sandboxed renderer and Electron.
 *
 * Nothing here takes a channel name from the caller: each method is a fixed,
 * typed capability. The main process additionally validates every payload and
 * the sending frame, so this file is intentionally dumb.
 */
const api: DesktopApi = {
  app: {
    getInfo: () => ipcRenderer.invoke(IPC_CHANNELS.appGetInfo),
  },
  secure: {
    get: (key: SecretKey) => ipcRenderer.invoke(IPC_CHANNELS.secureGet, key),
    set: (key: SecretKey, value: string) => ipcRenderer.invoke(IPC_CHANNELS.secureSet, key, value),
    delete: (key: SecretKey) => ipcRenderer.invoke(IPC_CHANNELS.secureDelete, key),
  },
  pin: {
    hash: (pin: string, salt: string) => ipcRenderer.invoke(IPC_CHANNELS.pinHash, pin, salt),
    verify: (verifier: string, pin: string, salt: string) =>
      ipcRenderer.invoke(IPC_CHANNELS.pinVerify, verifier, pin, salt),
  },
}

contextBridge.exposeInMainWorld('gikautos', api)
