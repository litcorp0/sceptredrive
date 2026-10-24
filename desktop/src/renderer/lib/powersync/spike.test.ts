import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Unit coverage for the spike's *logic* with a mocked SDK.
 *
 * The real proof that the Web SDK runs in the `app://` renderer is the Playwright
 * E2E (`desktop/test/e2e/powersync-spike.mjs`); this file keeps the step
 * orchestration, the persistence counter, and the failure paths honest without
 * needing WASM or Electron.
 */

type Row = { id: string; body: string }

const rows = new Map<string, Row>()
const failOnOpen = { value: false }

vi.mock('@powersync/web', () => {
  const WASQLiteVFS = {
    IDBBatchAtomicVFS: 'IDBBatchAtomicVFS',
    OPFSCoopSyncVFS: 'OPFSCoopSyncVFS',
  }

  class FakeDatabase {
    async execute(sql: string, params: unknown[] = []) {
      if (failOnOpen.value && sql.includes('SELECT 1')) {
        throw new TypeError('resolveVfs is not a function')
      }
      if (sql.startsWith('DELETE')) {
        for (const id of [...rows.keys()]) {
          if (id !== params[0]) rows.delete(id)
        }
        return { rowsAffected: 1 }
      }
      if (sql.startsWith('INSERT OR REPLACE')) {
        rows.set(String(params[0]), { id: String(params[0]), body: String(params[1]) })
        return { rowsAffected: 1 }
      }
      if (sql.startsWith('INSERT')) {
        rows.set(String(params[0]), { id: String(params[0]), body: String(params[1]) })
        return { rowsAffected: 1 }
      }
      if (sql.startsWith('UPDATE')) {
        rows.set(String(params[1]), { id: String(params[1]), body: String(params[0]) })
        return { rowsAffected: 1 }
      }
      return { rowsAffected: 0 }
    }

    async getOptional<T>(_sql: string, params: unknown[] = []): Promise<T | null> {
      return (rows.get(String(params[0])) as T | undefined) ?? null
    }

    watch() {
      return {
        [Symbol.asyncIterator]: () => ({
          async next() {
            return { value: { rows: [] }, done: false }
          },
          async return() {
            return { value: undefined, done: true }
          },
        }),
      }
    }

    async close() {}
  }

  return {
    Schema: class {
      constructor(tables: Record<string, unknown>) {
        Object.assign(this, tables)
      }
    },
    Table: class {
      constructor(columns: Record<string, unknown>) {
        Object.assign(this, columns)
      }
    },
    column: { text: 'text', integer: 'integer', real: 'real' },
    PowerSyncDatabase: FakeDatabase,
    WASQLiteOpenFactory: class {
      // biome-ignore lint/complexity/noUselessConstructor: mirrors the SDK shape
      constructor(_options: unknown) {}
    },
    WASQLiteVFS,
    LogLevels: { warn: 3 },
    createConsoleLogger: () => ({
      log() {},
      debug() {},
      info() {},
      warn() {},
      error() {},
      trace() {},
    }),
  }
})

const { runPowerSyncSpike, resolveDatabaseKey, SPIKE_DB_FILES } = await import('./spike')

function installKeychain(values: Record<string, string> = {}) {
  Object.defineProperty(globalThis, 'window', {
    value: {
      sceptreDrive: {
        app: { getInfo: async () => ({ ok: true, data: {} }) },
        secure: {
          get: async (key: string) =>
            key in values ? { ok: true, data: values[key] } : { ok: true, data: null },
          set: async (key: string, value: string) => {
            values[key] = value
            return { ok: true, data: null }
          },
          delete: async (key: string) => {
            delete values[key]
            return { ok: true, data: null }
          },
        },
      },
    },
    configurable: true,
    writable: true,
  })
  return values
}

beforeEach(() => {
  rows.clear()
  failOnOpen.value = false
})

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('resolveDatabaseKey', () => {
  it('generates a 32-byte key once and reuses it', async () => {
    const store = installKeychain()

    const first = await resolveDatabaseKey()
    const second = await resolveDatabaseKey()

    expect(first).toBe(second)
    expect(store.powersyncDbKey).toBe(first)
    // base64 of 32 bytes
    expect(first).toHaveLength(44)
  })

  it('fails when the bridge is unavailable', async () => {
    await expect(resolveDatabaseKey()).rejects.toThrow(/Keychain unavailable/)
  })
})

describe('runPowerSyncSpike', () => {
  it('runs every step against the default VFS', async () => {
    installKeychain()

    const report = await runPowerSyncSpike('default')

    expect(report.ok).toBe(true)
    expect(report.vfs).toBe('default')
    expect(report.steps.map((step) => step.name)).toEqual([
      'keychain encryption key',
      'open encrypted database',
      'insert local-only row',
      'read back',
      'update row',
      'watch query notifies',
      'persist across restarts',
      'close database',
      'reopen database and read row back',
    ])
    expect(report.steps.every((step) => step.ok)).toBe(true)
  })

  it('increments the persistence counter on every run', async () => {
    installKeychain()

    const first = await runPowerSyncSpike('opfscopysync')
    const second = await runPowerSyncSpike('opfscopysync')

    expect(first.persistRuns).toBe(1)
    expect(second.persistRuns).toBe(2)
  })

  it('reports a failing open instead of throwing', async () => {
    installKeychain()
    failOnOpen.value = true

    const report = await runPowerSyncSpike('default')

    expect(report.ok).toBe(false)
    expect(report.persistRuns).toBe(0)
    const open = report.steps.find((step) => step.name === 'open encrypted database')
    expect(open?.ok).toBe(false)
    expect(open?.detail).toMatch(/resolveVfs/)
  })

  it('stops early when the keychain is unavailable', async () => {
    installKeychain()

    const report = await runPowerSyncSpike('default')
    // Second call in the same window is fine; the point is the failure path.
    expect(report.ok).toBe(true)

    delete (globalThis as { window?: unknown }).window
    const failed = await runPowerSyncSpike('default')
    expect(failed.ok).toBe(false)
    expect(failed.steps).toHaveLength(1)
    expect(failed.steps[0]?.name).toBe('keychain encryption key')
  })

  it('uses separate files per VFS', () => {
    expect(SPIKE_DB_FILES.default).not.toBe(SPIKE_DB_FILES.opfscopysync)
  })
})
