import { contextBridge, ipcRenderer } from 'electron'
import {
  type DesktopApi,
  type DrawerRequest,
  IPC_CHANNELS,
  type PrintEncoding,
  type PrinterTarget,
  type PrintRequest,
  type SecretKey,
} from '../shared/ipc'

/**
 * The only bridge between the sandboxed renderer and Electron.
 *
 * Nothing here takes a channel name from the caller: each method is a fixed,
 * typed capability. The main process additionally validates every payload and
 * the sending frame, so this file is intentionally dumb.
 */
const api: DesktopApi = {
  // Synchronous on purpose: the renderer's config module is evaluated at import time, before
  // any promise could resolve, and these two URLs decide where it enrols.
  runtimeConfig: ipcRenderer.sendSync(IPC_CHANNELS.runtimeConfig) as DesktopApi['runtimeConfig'],
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
  printer: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.printerList),
    print: (request: PrintRequest) => ipcRenderer.invoke(IPC_CHANNELS.printerPrint, request),
    openDrawer: (request: DrawerRequest) =>
      ipcRenderer.invoke(IPC_CHANNELS.printerOpenDrawer, request),
    test: (request: { target: PrinterTarget; encoding: PrintEncoding }) =>
      ipcRenderer.invoke(IPC_CHANNELS.printerTest, request),
  },
  payments: {
    checkout: {
      open: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.checkoutOpen, url),
      close: () => ipcRenderer.invoke(IPC_CHANNELS.checkoutClose),
    },
  },
}

contextBridge.exposeInMainWorld('sceptreDrive', api)
