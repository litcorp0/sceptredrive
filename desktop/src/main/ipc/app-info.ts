import { app } from 'electron'
import type { AppInfo } from '../../shared/ipc'
import type { Keychain } from './keychain'

export async function getAppInfo(keychain: Keychain): Promise<AppInfo> {
  const secureStorage = await keychain.status()

  return {
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron ?? 'unknown',
    chrome: process.versions.chrome ?? 'unknown',
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    userDataPath: app.getPath('userData'),
    secureStorage,
  }
}
