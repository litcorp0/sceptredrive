import { describe, expect, it } from 'vitest'
import { buildDrawerBytes, buildReceiptBytes, drawerKickBytes, RECEIPT_COLUMNS } from './escpos'

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
