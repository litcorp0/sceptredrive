import {
  createConsoleLogger,
  LogLevels,
  PowerSyncDatabase,
  WASQLiteOpenFactory,
  WASQLiteVFS,
} from '@powersync/web'
import { desktopApi, isDesktopAvailable } from '../desktop-api'
import { SpikeSchema } from './spike-schema'

/**
 * PowerSync Web SDK spike — the Phase 6 gate.
 *
 * Proves, inside the sandboxed renderer served from `app://sceptre-drive`:
 *   1. the WASM SQLite database opens (worker + `wasm-unsafe-eval`),
 *   2. it is encrypted with a key held in the OS keychain,
 *   3. local-only writes insert, read, update, and notify watchers,
 *   4. data survives closing and reopening the database,
 *   5. both candidate VFS backends behave as documented.
 *
 * No `connect()` call: this is a local-only spike, so nothing is synced.
 */

export type SpikeVfs = 'default' | 'opfscopysync'

export type SpikeStep = { name: string; ok: boolean; detail?: string }

export type SpikeReport = {
  ok: boolean
  vfs: SpikeVfs
  steps: SpikeStep[]
  durationMs: number
  /** How many times this database has run the spike (proves on-disk persistence). */
  persistRuns: number
}

export const SPIKE_DB_FILES: Record<SpikeVfs, string> = {
  default: 'sceptre-drive-spike-default.db',
  opfscopysync: 'sceptre-drive-spike-opfs.db',
}

const STEP_TIMEOUT_MS = 20_000

/** Stable id used to prove the database survives an app restart. */
const PERSIST_ID = 'spike-persist'

/** The SDK's own pre-built worker, copied to `public/@powersync` by `copy-assets`. */
export const POWERSYNC_WORKER_URL = '/@powersync/worker.js'

class SpikeTimeout extends Error {}

async function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new SpikeTimeout(`${label} timed out`)), STEP_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function randomKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}

/**
 * Reads the database encryption key, generating it on first use.
 *
 * Failures are surfaced to the caller instead of silently running unencrypted:
 * an unencrypted local database would hold a whole branch's sales history.
 */
export async function resolveDatabaseKey(): Promise<string> {
  if (!isDesktopAvailable()) {
    throw new Error('Keychain unavailable outside the desktop shell')
  }

  const existing = await desktopApi.getSecret('powersyncDbKey')
  if (existing) return existing

  const generated = randomKey()
  await desktopApi.setSecret('powersyncDbKey', generated)
  return generated
}

function createDatabase(filename: string, encryptionKey: string, vfs: SpikeVfs): PowerSyncDatabase {
  // Build the adapter factory explicitly rather than letting the SDK resolve
  // defaults: the SDK's VFS resolver has no default branch, so any path that
  // reaches it with `vfs` undefined throws `resolveVfs is not a function`.
  const factory = new WASQLiteOpenFactory({
    open: {
      dbFilename: filename,
      vfs: vfs === 'opfscopysync' ? WASQLiteVFS.OPFSCoopSyncVFS : WASQLiteVFS.IDBBatchAtomicVFS,
      // ChaCha20 via SQLite3MultipleCiphers; the key never leaves the keychain
      // except to open the database.
      encryptionKey,
      // The POS is a single-instance desktop app: shared workers (the multi-tab
      // default) add a moving part and do not work under `app://`.
      enableMultiTabs: false,
      // The SDK's own worker instead of a bundler-generated one: it resolves its
      // dynamic VFS imports relative to the copied assets, which is what works
      // inside a packaged `app://` renderer.
      worker: POWERSYNC_WORKER_URL,
    },
    logger: createConsoleLogger({ minLevel: LogLevels.warn }),
  })

  return new PowerSyncDatabase({ schema: SpikeSchema, factory })
}

export async function runPowerSyncSpike(vfs: SpikeVfs): Promise<SpikeReport> {
  const startedAt = performance.now()
  const steps: SpikeStep[] = []

  const record = async (name: string, work: () => Promise<string | undefined>) => {
    try {
      const detail = await withTimeout(Promise.resolve().then(work), name)
      steps.push({ name, ok: true, detail })
      return true
    } catch (error) {
      steps.push({
        name,
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      })
      return false
    }
  }

  let encryptionKey: string | null = null
  const keyOk = await record('keychain encryption key', async () => {
    encryptionKey = await resolveDatabaseKey()
    return `${encryptionKey.length} chars, source=keychain`
  })

  if (!keyOk || !encryptionKey) {
    return { ok: false, vfs, steps, durationMs: performance.now() - startedAt, persistRuns: 0 }
  }

  const key: string = encryptionKey
  const filename = SPIKE_DB_FILES[vfs]
  let db = createDatabase(filename, key, vfs)

  const closeSafely = async (target: PowerSyncDatabase) => {
    try {
      await target.close()
    } catch {
      // Closing a failed handle is best effort.
    }
  }

  const opened = await record('open encrypted database', async () => {
    await db.execute('SELECT 1')
    return `vfs=${vfs}`
  })
  if (!opened) {
    await closeSafely(db)
    return { ok: false, vfs, steps, durationMs: performance.now() - startedAt, persistRuns: 0 }
  }

  const noteId = crypto.randomUUID()
  const body = `spike-${crypto.randomUUID()}`

  const inserted = await record('insert local-only row', async () => {
    // Clear leftovers from a previous run so the assertions stay deterministic —
    // but never the persistence marker, which must survive restarts.
    await db.execute('DELETE FROM spike_note WHERE id != ?', [PERSIST_ID])
    await db.execute(
      'INSERT INTO spike_note (id, body, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [noteId, body, new Date().toISOString(), new Date().toISOString()],
    )
    return noteId
  })

  if (inserted) {
    await record('read back', async () => {
      const row = await db.getOptional<{ id: string; body: string }>(
        'SELECT id, body FROM spike_note WHERE id = ?',
        [noteId],
      )
      if (!row) throw new Error('row not found after insert')
      if (row.body !== body) throw new Error('row body mismatch')
      return 'row matches'
    })

    await record('update row', async () => {
      await db.execute('UPDATE spike_note SET body = ? WHERE id = ?', [`${body}-updated`, noteId])
      const row = await db.getOptional<{ body: string }>(
        'SELECT body FROM spike_note WHERE id = ?',
        [noteId],
      )
      if (row?.body !== `${body}-updated`) throw new Error('update not visible')
      return 'update visible'
    })

    await record('watch query notifies', async () => {
      // The async-generator form is the cancellable one: breaking the loop (or
      // calling return()) releases the subscription.
      const iterator = db.watch('SELECT id FROM spike_note', [])[Symbol.asyncIterator]()
      try {
        await withTimeout(iterator.next(), 'watch initial result')
        await db.execute(
          'INSERT INTO spike_note (id, body, created_at, updated_at) VALUES (?, ?, ?, ?)',
          [
            crypto.randomUUID(),
            `${body}-watch`,
            new Date().toISOString(),
            new Date().toISOString(),
          ],
        )
        const changed = await withTimeout(iterator.next(), 'watch update')
        if (changed.done) throw new Error('watch stream ended early')
      } finally {
        await iterator.return?.()
      }
      return 'callback fired'
    })
  }

  let persistRuns = 0
  await record('persist across restarts', async () => {
    const row = await db.getOptional<{ body: string }>('SELECT body FROM spike_note WHERE id = ?', [
      PERSIST_ID,
    ])
    const previous = row ? Number.parseInt(row.body.replace('persist:', ''), 10) || 0 : 0
    persistRuns = previous + 1
    const now = new Date().toISOString()
    await db.execute(
      'INSERT OR REPLACE INTO spike_note (id, body, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [PERSIST_ID, `persist:${persistRuns}`, now, now],
    )
    return `run #${persistRuns}`
  })

  await record('close database', async () => {
    await db.close()
  })

  const reopened = await record('reopen database and read row back', async () => {
    db = createDatabase(filename, key, vfs)
    const row = await db.getOptional<{ id: string; body: string }>(
      'SELECT id, body FROM spike_note WHERE id = ?',
      [noteId],
    )
    if (!row) throw new Error('row lost after reopen')
    if (row.body !== `${body}-updated`) throw new Error('persisted value mismatch')
    return 'row survived restart'
  })

  await closeSafely(db)

  const errors = steps.filter((step) => !step.ok)
  return {
    ok: errors.length === 0 && reopened,
    vfs,
    steps,
    durationMs: Math.round(performance.now() - startedAt),
    persistRuns,
  }
}
