import type { PowerSyncDatabase } from '@powersync/web'
import {
  type DrawerPin,
  PRINT_ENCODINGS,
  PRINT_LIMITS,
  PRINTER_DRIVERS,
  type PrintEncoding,
  type PrinterDriver,
  type PrinterTarget,
} from '../../../shared/printing'

/**
 * Per-device printer settings (Plan 07 Task 3).
 *
 * These are hardware facts, not server policy: which queue, which drawer pin,
 * how many copies. They live in the local-only `device_setting` table so a
 * manager can set them once per terminal, offline. Server-owned receipt text
 * (`receipt_header`/`receipt_footer`) stays in `pos_config`.
 */

export const CURRENCY_SYMBOLS = ['GHS', 'GH₵'] as const
export type CurrencySymbol = (typeof CURRENCY_SYMBOLS)[number]

export interface PrinterSettings {
  driver: PrinterDriver
  printerName: string
  printerHost: string
  printerPort: number
  drawerPin: DrawerPin
  encoding: PrintEncoding
  copies: number
  /** `GHS` for ESC/POS by default; `GH₵` is available when the charset allows it. */
  currencySymbol: CurrencySymbol
}

export const DEFAULT_PRINTER_SETTINGS: PrinterSettings = {
  // The fake adapter is the safe default: a fresh terminal never throws a
  // native error before a manager has chosen its printer.
  driver: 'fake',
  printerName: '',
  printerHost: '',
  printerPort: PRINT_LIMITS.defaultPort,
  drawerPin: 2,
  encoding: 'windows-1252',
  copies: 1,
  currencySymbol: 'GHS',
}

const SETTING_KEYS = {
  driver: 'printer.driver',
  printerName: 'printer.name',
  printerHost: 'printer.host',
  printerPort: 'printer.port',
  drawerPin: 'printer.drawerPin',
  encoding: 'printer.encoding',
  copies: 'printer.copies',
  currencySymbol: 'receipt.currencySymbol',
} as const

const HOST_PATTERN = /^[A-Za-z0-9._:-]+$/

function isDrawerPin(value: unknown): value is DrawerPin {
  return value === 2 || value === 5
}

function isDriver(value: unknown): value is PrinterDriver {
  return (PRINTER_DRIVERS as readonly unknown[]).includes(value)
}

function isEncoding(value: unknown): value is PrintEncoding {
  return (PRINT_ENCODINGS as readonly unknown[]).includes(value)
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : fallback
}

export function parsePrinterSettings(
  rows: ReadonlyArray<{ key: string; value: string }>,
): PrinterSettings {
  const map = new Map(rows.map((row) => [row.key, row.value]))

  const driver = map.get(SETTING_KEYS.driver)
  const drawerPin = Number(map.get(SETTING_KEYS.drawerPin))
  const encoding = map.get(SETTING_KEYS.encoding)
  const currencySymbol = map.get(SETTING_KEYS.currencySymbol)

  return {
    driver: isDriver(driver) ? driver : DEFAULT_PRINTER_SETTINGS.driver,
    printerName: (map.get(SETTING_KEYS.printerName) ?? '').slice(0, 128),
    printerHost: (map.get(SETTING_KEYS.printerHost) ?? '').slice(0, 255),
    printerPort: parseInteger(map.get(SETTING_KEYS.printerPort), PRINT_LIMITS.defaultPort),
    drawerPin: isDrawerPin(drawerPin) ? drawerPin : DEFAULT_PRINTER_SETTINGS.drawerPin,
    encoding: isEncoding(encoding) ? encoding : DEFAULT_PRINTER_SETTINGS.encoding,
    copies: Math.min(
      PRINT_LIMITS.maxCopies,
      Math.max(1, parseInteger(map.get(SETTING_KEYS.copies), 1)),
    ),
    currencySymbol:
      currencySymbol === 'GH₵' || currencySymbol === 'GHS'
        ? currencySymbol
        : DEFAULT_PRINTER_SETTINGS.currencySymbol,
  }
}

export async function loadPrinterSettings(db: PowerSyncDatabase): Promise<PrinterSettings> {
  const rows = await db.getAll<{ key: string; value: string }>(
    'SELECT key, value FROM device_setting',
  )
  return parsePrinterSettings(rows)
}

/** Returns a human problem, or null when the settings are usable. */
export function printerSettingsProblem(settings: PrinterSettings): string | null {
  if (!isDriver(settings.driver)) return 'Choose a printer driver'
  if (settings.driver === 'winspool' && !settings.printerName.trim()) {
    return 'Choose a Windows printer queue'
  }
  if (settings.driver === 'network') {
    if (!HOST_PATTERN.test(settings.printerHost.trim())) return 'Enter a valid printer address'
    if (
      !Number.isInteger(settings.printerPort) ||
      settings.printerPort < 1 ||
      settings.printerPort > 65_535
    ) {
      return 'The printer port must be between 1 and 65535'
    }
  }
  if (!isDrawerPin(settings.drawerPin)) return 'The drawer pin must be 2 or 5'
  if (!isEncoding(settings.encoding)) return 'Choose a supported character set'
  if (!Number.isInteger(settings.copies) || settings.copies < 1 || settings.copies > 3) {
    return 'Copies must be between 1 and 3'
  }
  if (!CURRENCY_SYMBOLS.includes(settings.currencySymbol)) return 'Choose a currency symbol'
  return null
}

export function toPrinterTarget(settings: PrinterSettings): PrinterTarget {
  if (settings.driver === 'winspool') {
    return { driver: 'winspool', printerName: settings.printerName.trim() }
  }
  if (settings.driver === 'network') {
    return {
      driver: 'network',
      host: settings.printerHost.trim(),
      port: settings.printerPort,
    }
  }
  return { driver: 'fake' }
}

export async function savePrinterSettings(
  db: PowerSyncDatabase,
  settings: PrinterSettings,
): Promise<void> {
  const problem = printerSettingsProblem(settings)
  if (problem) throw new Error(problem)

  const now = new Date().toISOString()
  const values: Record<(typeof SETTING_KEYS)[keyof typeof SETTING_KEYS], string> = {
    [SETTING_KEYS.driver]: settings.driver,
    [SETTING_KEYS.printerName]: settings.printerName.trim(),
    [SETTING_KEYS.printerHost]: settings.printerHost.trim(),
    [SETTING_KEYS.printerPort]: String(settings.printerPort),
    [SETTING_KEYS.drawerPin]: String(settings.drawerPin),
    [SETTING_KEYS.encoding]: settings.encoding,
    [SETTING_KEYS.copies]: String(settings.copies),
    [SETTING_KEYS.currencySymbol]: settings.currencySymbol,
  }

  await db.writeTransaction(async (tx) => {
    for (const [key, value] of Object.entries(values)) {
      await tx.execute(
        `INSERT OR REPLACE INTO device_setting (id, key, value, updated_at)
         VALUES (?, ?, ?, ?)`,
        [key, key, value, now],
      )
    }
  })
}
