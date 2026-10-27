import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { PrintJob } from '../../shared/printing'
import { printerJobSchema, printReport } from './printer'

/**
 * The report IPC (P13-D34).
 *
 * The main process is handed a bounded document and never a business term, and
 * a report can neither open the drawer nor smuggle in more than 400 rows. The
 * fake adapter proves the file a dev terminal produces is the report, not an
 * empty receipt.
 */

const REPORT_JOB = {
  receiptNumber: 'ACC-SPX-T01-S-20261027-01',
  lines: [],
  encoding: 'windows-1252',
  copies: 1,
  openDrawer: false,
  drawerPin: 2,
  report: {
    title: 'Z-REPORT',
    reference: 'ACC-SPX-T01-S-20261027-01',
    lines: [
      { kind: 'title', label: 'Z-REPORT' },
      { kind: 'rule' },
      { kind: 'row', label: 'Cash', value: 'GHS 300.00' },
      { kind: 'total', label: 'Variance', value: 'Exact' },
    ],
  },
}

function runtime() {
  const receiptsDir = mkdtempSync(path.join(tmpdir(), 'sceptre-report-'))
  return { receiptsDir, isPackaged: false, log: () => {} }
}

describe('report job validation', () => {
  it('accepts a report document with no receipt lines', () => {
    expect(() => printerJobSchema.parse(REPORT_JOB)).not.toThrow()
  })

  it('refuses a report that would open the cash drawer', () => {
    expect(() => printerJobSchema.parse({ ...REPORT_JOB, openDrawer: true })).toThrow()
  })

  it('refuses an unbounded row list and an unprintable reference', () => {
    const tooMany = {
      ...REPORT_JOB,
      report: {
        ...REPORT_JOB.report,
        lines: Array.from({ length: 401 }, () => ({ kind: 'rule' as const })),
      },
    }
    expect(() => printerJobSchema.parse(tooMany)).toThrow()

    expect(() =>
      printerJobSchema.parse({
        ...REPORT_JOB,
        report: { ...REPORT_JOB.report, reference: 'SHIFT/2026 27' },
      }),
    ).toThrow()
  })

  it('still accepts an ordinary receipt job', () => {
    expect(() =>
      printerJobSchema.parse({
        receiptNumber: 'ACC-SPX-T01-20261027-0001',
        lines: [{ text: 'Sceptre Drive' }],
        encoding: 'cp437',
        copies: 2,
        openDrawer: true,
        drawerPin: 5,
      }),
    ).not.toThrow()
  })
})

describe('printReport', () => {
  it('writes the report rows to the fake printer', async () => {
    const printer = runtime()
    const job = REPORT_JOB as unknown as PrintJob

    const outcome = await printReport(printer, { driver: 'fake' }, job)

    expect(outcome).toMatchObject({ ok: true })
    const text = readFileSync(
      path.join(printer.receiptsDir, `${REPORT_JOB.receiptNumber}.txt`),
      'utf8',
    )
    expect(text).toContain('Z-REPORT')
    expect(text).toContain('GHS 300.00')
    expect(text).toContain('Variance')
  })

  it('refuses a job that carries no document', async () => {
    await expect(
      printReport(
        runtime(),
        { driver: 'fake' },
        {
          receiptNumber: 'X',
          lines: [],
          encoding: 'windows-1252',
          copies: 1,
          openDrawer: false,
          drawerPin: 2,
        },
      ),
    ).rejects.toThrow('report document')
  })
})
