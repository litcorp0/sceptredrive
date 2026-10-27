import { describe, expect, it } from 'vitest'
import type { ReportDocument } from '../../shared/printing'
import {
  buildDrawerBytes,
  buildReceiptBytes,
  buildReportBytes,
  drawerKickBytes,
  RECEIPT_COLUMNS,
  reportToPrintLines,
} from './escpos'

const JOB = {
  lines: [
    { text: 'Sceptre Drive', bold: true },
    { text: 'RECEIPT ACC-SPX-T01-20261023-0001' },
    { text: 'TOTAL                         GHS 265.00', bold: true },
  ],
  encoding: 'windows-1252' as const,
  openDrawer: true,
  drawerPin: 2 as const,
}

describe('ESC/POS receipt bytes', () => {
  it('initializes, contains the receipt text, kicks the drawer, and cuts', () => {
    const bytes = Buffer.from(buildReceiptBytes(JOB))

    expect([bytes[0], bytes[1]]).toEqual([0x1b, 0x40])
    expect(bytes.includes(Buffer.from('RECEIPT ACC-SPX-T01-20261023-0001'))).toBe(true)
    expect(bytes.includes(Buffer.from('GHS 265.00'))).toBe(true)
    expect(bytes.includes(Buffer.from(drawerKickBytes(2)))).toBe(true)
    expect(Array.from(bytes.subarray(-3))).toEqual([0x1d, 0x56, 0x00])
  })

  it('emits the drawer kick before the cut, so the file still ends with a cut', () => {
    const bytes = Buffer.from(buildReceiptBytes(JOB))
    const drawer = bytes.indexOf(Buffer.from(drawerKickBytes(2)))
    const cut = bytes.lastIndexOf(Buffer.from([0x1d, 0x56, 0x00]))
    expect(drawer).toBeGreaterThan(0)
    expect(cut).toBeGreaterThan(drawer)
  })

  it('omits the drawer kick for a credit sale and uses pin 5 when configured', () => {
    const credit = Buffer.from(buildReceiptBytes({ ...JOB, openDrawer: false }))
    expect(credit.includes(Buffer.from(drawerKickBytes(2)))).toBe(false)

    const pin5 = Buffer.from(buildReceiptBytes({ ...JOB, drawerPin: 5 }))
    expect(pin5.includes(Buffer.from(drawerKickBytes(5)))).toBe(true)
    expect(drawerKickBytes(5)).toEqual([0x1b, 0x70, 0x01, 50, 250])
  })

  it('repeats the block for copies', () => {
    const one = buildReceiptBytes(JOB, 1)
    const two = buildReceiptBytes(JOB, 2)
    expect(two.length).toBe(one.length * 2)
  })

  it('exposes the 80 mm column width', () => {
    expect(RECEIPT_COLUMNS).toBe(42)
  })
})

describe('drawer-only bytes', () => {
  it('is a standalone ESC p sequence', () => {
    const bytes = Buffer.from(buildDrawerBytes(2))
    expect([bytes[0], bytes[1]]).toEqual([0x1b, 0x40])
    expect(bytes.includes(Buffer.from(drawerKickBytes(2)))).toBe(true)
    expect(bytes.length).toBe(7)
  })
})

describe('ESC/POS report bytes', () => {
  const REPORT: ReportDocument = {
    title: 'Z-REPORT',
    reference: 'ACC-SPX-T01-20261027-01',
    lines: [
      { kind: 'title', label: 'Sceptre Drive' },
      { kind: 'rule' },
      { kind: 'row', label: 'Cash', value: 'GHS 300.00' },
      { kind: 'total', label: 'NET', value: 'GHS 400.00' },
    ],
  }

  it('lays the four roles out as paper rows', () => {
    const lines = reportToPrintLines(REPORT)

    expect(lines[0]?.bold).toBe(true)
    expect(lines[0]?.text.trim()).toBe('Sceptre Drive')
    expect(lines[1]?.text).toBe('-'.repeat(RECEIPT_COLUMNS))
    expect(lines[2]?.text).toHaveLength(RECEIPT_COLUMNS)
    expect(lines[2]?.text.startsWith('Cash')).toBe(true)
    expect(lines[2]?.text.endsWith('GHS 300.00')).toBe(true)
    expect(lines[3]?.bold).toBe(true)
  })

  it('prints the report text, feeds, and cuts — and never kicks the drawer', () => {
    const bytes = Buffer.from(buildReportBytes(REPORT, { encoding: 'windows-1252' }))

    expect([bytes[0], bytes[1]]).toEqual([0x1b, 0x40])
    expect(bytes.includes(Buffer.from('GHS 300.00'))).toBe(true)
    expect(bytes.includes(Buffer.from('NET'))).toBe(true)
    expect(bytes.includes(Buffer.from(drawerKickBytes(2)))).toBe(false)
    expect(Array.from(bytes.subarray(-3))).toEqual([0x1d, 0x56, 0x00])
  })

  it('repeats the block for copies', () => {
    const one = buildReportBytes(REPORT, { encoding: 'windows-1252' })
    const two = buildReportBytes(REPORT, { encoding: 'windows-1252', copies: 2 })
    expect(two.length).toBe(one.length * 2)
  })

  it('dispatches a job carrying a report through the report builder', () => {
    const reportBytes = buildReportBytes(REPORT, { encoding: 'windows-1252' })
    const jobBytes = buildReceiptBytes(
      { lines: [], encoding: 'windows-1252', openDrawer: false, drawerPin: 2, report: REPORT },
      1,
    )
    expect(Buffer.from(jobBytes).equals(Buffer.from(reportBytes))).toBe(true)
  })
})
