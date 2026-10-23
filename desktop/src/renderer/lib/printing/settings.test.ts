import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRINTER_SETTINGS,
  loadPrinterSettings,
  parsePrinterSettings,
  printerSettingsProblem,
  savePrinterSettings,
  toPrinterTarget,
} from './settings'

/**
 * Printer settings are local hardware facts. A malformed value must never reach
 * the native adapter, and a saved value must survive a reload.
 */

describe('parsePrinterSettings', () => {
  it('falls back to the fake driver when nothing is stored', () => {
    expect(parsePrinterSettings([])).toEqual(DEFAULT_PRINTER_SETTINGS)
  })

  it('round-trips stored values', () => {
    const settings = parsePrinterSettings([
      { key: 'printer.driver', value: 'network' },
      { key: 'printer.host', value: '192.168.1.50' },
      { key: 'printer.port', value: '9100' },
      { key: 'printer.drawerPin', value: '5' },
      { key: 'printer.encoding', value: 'cp437' },
      { key: 'printer.copies', value: '2' },
      { key: 'receipt.currencySymbol', value: 'GH₵' },
    ])

    expect(settings.driver).toBe('network')
    expect(settings.printerHost).toBe('192.168.1.50')
    expect(settings.drawerPin).toBe(5)
    expect(settings.encoding).toBe('cp437')
    expect(settings.copies).toBe(2)
    expect(settings.currencySymbol).toBe('GH₵')
  })

  it('ignores corrupt values instead of trusting them', () => {
    const settings = parsePrinterSettings([
      { key: 'printer.driver', value: 'rm -rf' },
      { key: 'printer.drawerPin', value: '99' },
      { key: 'printer.encoding', value: 'utf-16' },
      { key: 'printer.copies', value: '999' },
      { key: 'receipt.currencySymbol', value: '<script>' },
    ])

    expect(settings.driver).toBe('fake')
    expect(settings.drawerPin).toBe(2)
    expect(settings.encoding).toBe('windows-1252')
    expect(settings.copies).toBe(3)
    expect(settings.currencySymbol).toBe('GHS')
  })
})

describe('printerSettingsProblem', () => {
  it('accepts the defaults', () => {
    expect(printerSettingsProblem(DEFAULT_PRINTER_SETTINGS)).toBeNull()
  })

  it('requires a queue for winspool and a host for network', () => {
    expect(
      printerSettingsProblem({ ...DEFAULT_PRINTER_SETTINGS, driver: 'winspool', printerName: '' }),
    ).toMatch(/printer queue/i)
    expect(
      printerSettingsProblem({ ...DEFAULT_PRINTER_SETTINGS, driver: 'network', printerHost: '' }),
    ).toMatch(/address/i)
    expect(
      printerSettingsProblem({
        ...DEFAULT_PRINTER_SETTINGS,
        driver: 'network',
        printerHost: 'bad host',
      }),
    ).toMatch(/address/i)
    expect(
      printerSettingsProblem({
        ...DEFAULT_PRINTER_SETTINGS,
        driver: 'network',
        printerHost: '10.0.0.5',
        printerPort: 0,
      }),
    ).toMatch(/port/i)
  })
})

describe('toPrinterTarget', () => {
  it('maps each driver without leaking extra fields', () => {
    expect(toPrinterTarget(DEFAULT_PRINTER_SETTINGS)).toEqual({ driver: 'fake' })
    expect(
      toPrinterTarget({ ...DEFAULT_PRINTER_SETTINGS, driver: 'winspool', printerName: ' EPSON ' }),
    ).toEqual({ driver: 'winspool', printerName: 'EPSON' })
    expect(
      toPrinterTarget({
        ...DEFAULT_PRINTER_SETTINGS,
        driver: 'network',
        printerHost: ' 10.0.0.5 ',
        printerPort: 9100,
      }),
    ).toEqual({ driver: 'network', host: '10.0.0.5', port: 9100 })
  })
})

describe('save + load', () => {
  it('upserts every key in one transaction', async () => {
    const writes: Array<{ sql: string; parameters?: unknown[] }> = []
    const db = {
      getAll: async () => [],
      writeTransaction: async <T>(
        work: (tx: {
          execute: (sql: string, parameters?: unknown[]) => Promise<void>
        }) => Promise<T>,
      ) =>
        work({
          execute: async (sql: string, parameters?: unknown[]) => {
            writes.push({ sql, parameters })
          },
        }),
    }

    await savePrinterSettings(db as never, {
      ...DEFAULT_PRINTER_SETTINGS,
      driver: 'network',
      printerHost: '10.0.0.5',
    })

    expect(writes).toHaveLength(8)
    expect(
      writes.every((write) => write.sql.includes('INSERT OR REPLACE INTO device_setting')),
    ).toBe(true)
  })

  it('refuses to save an invalid target', async () => {
    const db = { getAll: async () => [], writeTransaction: async () => undefined }
    await expect(
      savePrinterSettings(db as never, {
        ...DEFAULT_PRINTER_SETTINGS,
        driver: 'network',
        printerHost: '',
      }),
    ).rejects.toThrow(/address/i)
  })

  it('loads from the local table', async () => {
    const db = {
      getAll: async () => [
        { key: 'printer.driver', value: 'winspool' },
        { key: 'printer.name', value: 'EPSON' },
      ],
    }
    const loaded = await loadPrinterSettings(db as never)
    expect(loaded.driver).toBe('winspool')
    expect(loaded.printerName).toBe('EPSON')
  })
})
