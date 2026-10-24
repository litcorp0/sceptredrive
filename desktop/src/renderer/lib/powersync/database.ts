import {
  createConsoleLogger,
  LogLevels,
  PowerSyncDatabase,
  WASQLiteOpenFactory,
  WASQLiteVFS,
} from '@powersync/web'
import { desktopApi, isDesktopAvailable } from '../desktop-api'
import { PosSchema } from './schema'

/**
 * The one PowerSync database instance for this terminal.
 *
 * Created lazily because the encryption key comes from the OS keychain (async).
 * The module-level promise is the Strict Mode guard: a double render must never
 * open two databases on the same file.
 */

export const POS_DB_FILENAME = 'sceptre-drive-pos.db'

/** SDK pre-built worker, copied to `public/@powersync` by `copy-assets`. */
const WORKER_URL = '/@powersync/worker.js'

let databasePromise: Promise<PowerSyncDatabase> | null = null

/**
 * 32-byte database key, generated on first use and kept in the OS keychain.
 * Without a keychain there is no local database: an unencrypted file would hold
 * a branch's sales history.
 */
async function resolveEncryptionKey(): Promise<string> {
  if (!isDesktopAvailable()) {
    throw new Error('The desktop bridge is required to open the local database')
  }

  const existing = await desktopApi.getSecret('powersyncDbKey')
  if (existing) return existing

  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  const generated = btoa(String.fromCharCode(...bytes))
  await desktopApi.setSecret('powersyncDbKey', generated)
  return generated
}

export function getDatabase(): Promise<PowerSyncDatabase> {
  if (!databasePromise) {
    databasePromise = (async () => {
      const encryptionKey = await resolveEncryptionKey()

      // The adapter is built explicitly: the SDK's VFS resolver has no default
      // branch, so everything it needs is named here (see the Plan 02 gate).
      const opened = new WASQLiteOpenFactory({
        open: {
          dbFilename: POS_DB_FILENAME,
          vfs: WASQLiteVFS.OPFSCoopSyncVFS,
          encryptionKey,
          // Single-instance desktop app: no shared workers.
          enableMultiTabs: false,
          worker: WORKER_URL,
        },
        logger: createConsoleLogger({ minLevel: LogLevels.warn }),
      })

      return new PowerSyncDatabase({ schema: PosSchema, factory: opened })
    })()
  }

  return databasePromise
}

/** Test/teardown seam: closes and forgets the instance. */
export async function closeDatabaseForTests(): Promise<void> {
  if (!databasePromise) return
  const db = await databasePromise
  databasePromise = null
  await db.close()
}
