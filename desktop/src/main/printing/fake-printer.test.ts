import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildReceiptBytes, drawerKickBytes } from './escpos'
import {
  DRAWER_LOG_FILE,
  FAIL_ALWAYS_FILE,
  FAIL_NEXT_FILE,
  fakeOpenDrawer,
  fakePrint,
} from './fake-printer'

const JOB = {
  receiptNumber: 'ACC-SPX-T01-20261023-0007',
  lines: [
    { text: 'Sceptre Drive', bold: true },
    { text: 'RECEIPT ACC-SPX-T01-20261023-0007' },
    { text: 'TOTAL                           GHS 265.00', bold: true },
  ],
  encoding: 'windows-1252' as const,
  copies: 1,
  openDrawer: true,
  drawerPin: 2 as const,
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'sceptre-drive-print-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('fake printer', () => {
  it('writes the text, the exact ESC/POS bytes, and a drawer log line', () => {
    const outcome = fakePrint(dir, JOB)
    expect(outcome.ok).toBe(true)

    const text = readFileSync(path.join(dir, `${JOB.receiptNumber}.txt`), 'utf8')
    expect(text).toContain('RECEIPT ACC-SPX-T01-20261023-0007')
    expect(text.split('\n').every((line) => line.length <= 200)).toBe(true)

    const binary = readFileSync(path.join(dir, `${JOB.receiptNumber}.escpos.bin`))
    expect(binary.equals(Buffer.from(buildReceiptBytes(JOB)))).toBe(true)
    expect(binary.includes(Buffer.from(drawerKickBytes(2)))).toBe(true)

    const log = readFileSync(path.join(dir, DRAWER_LOG_FILE), 'utf8')
    expect(log).toContain(`${JOB.receiptNumber} pin=2`)
  })

  it('fails once when `.fail-next` exists, then succeeds on retry', () => {
    writeFileSync(path.join(dir, FAIL_NEXT_FILE), '')
    const first = fakePrint(dir, JOB)
    expect(first.ok).toBe(false)
    if (!first.ok) expect(first.code).toBe('PRINTER_FAILED')

    const retry = fakePrint(dir, JOB)
    expect(retry.ok).toBe(true)
  })

  it('fails every time while `.fail-always` exists', () => {
    writeFileSync(path.join(dir, FAIL_ALWAYS_FILE), '')
    expect(fakePrint(dir, JOB).ok).toBe(false)
    expect(fakePrint(dir, JOB).ok).toBe(false)
    expect(fakeOpenDrawer(dir, 2).ok).toBe(false)
  })

  it('opens the drawer without a receipt', () => {
    const outcome = fakeOpenDrawer(dir, 5)
    expect(outcome.ok).toBe(true)
    expect(readFileSync(path.join(dir, DRAWER_LOG_FILE), 'utf8')).toContain('standalone pin=5')
  })

  it('refuses a receipt number that is unsafe as a file name', () => {
    const outcome = fakePrint(dir, { ...JOB, receiptNumber: '../../etc/passwd' })
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.code).toBe('PRINTER_FAILED')
  })
})
