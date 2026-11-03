import { describe, expect, it } from 'vitest'
import type { PrinterInfo, PrinterTarget, PrintJob, PrintOutcome } from '../../../shared/printing'
import type { ReceiptContext } from '../receipt/render'
import type { SaleLineRow, SaleRow, SaleTenderRow } from '../sale/sale-repository'
import { createSaleStore, openDrawerNow, printSale, type SaleStore } from './print-sale'
import type { PrinterTransport } from './printer-service'
import { DEFAULT_PRINTER_SETTINGS } from './settings'

const SALE: SaleRow = {
  id: '55555555-5555-7555-8555-555555555555',
  receiptNumber: 'ACC-SPX-T01-20261023-0007',
  branchId: 'branch-1',
  terminalId: 'terminal-1',
  deviceId: 'device-1',
  shiftId: 'shift-1',
  clientTransactionId: '55555555-5555-7555-8555-555555555555',
  cashierUserId: 'user-cashier',
  cashierStaffId: 'SD-0003',
  customerId: null,
  occurredAt: '2026-10-23T10:15:00.000Z',
  subtotalMinor: 12_000,
  lineDiscountMinor: 0,
  saleDiscountMinor: 0,
  loyaltyRedeemPoints: 0,
  loyaltyDiscountMinor: 0,
  vatMinor: 1_500,
  nhilMinor: 250,
  getfundMinor: 250,
  taxTotalMinor: 2_000,
  totalMinor: 12_000,
  tenderTotalMinor: 15_000,
  changeMinor: 3_000,
  loyaltyEarnedPoints: 100,
  creditAmountMinor: 0,
  taxMode: 'INCLUSIVE',
  appVersion: '0.1.0',
  printStatus: 'PENDING',
  printedAt: null,
  printError: null,
  reprintCount: 0,
  createdAt: '2026-10-23T10:15:00.000Z',
}

const LINE: SaleLineRow = {
  saleId: SALE.id,
  lineNumber: 1,
  productId: '11111111-1111-7111-8111-111111111111',
  sku: 'SDP-00001',
  name: 'Brake Pad Set',
  barcode: null,
  quantity: 2,
  unitPriceMinor: 6_000,
  expectedUnitPriceMinor: 6_000,
  lineDiscountMinor: 0,
  saleDiscountMinor: 0,
  loyaltyDiscountMinor: 0,
  netMinor: 12_000,
  taxableMinor: 10_000,
  baseMinor: 10_000,
  vatMinor: 1_500,
  nhilMinor: 250,
  getfundMinor: 250,
  taxTotalMinor: 2_000,
  totalMinor: 12_000,
  taxCategory: 'STANDARD',
}

const CASH: SaleTenderRow = {
  saleId: SALE.id,
  sequence: 1,
  method: 'CASH',
  amountMinor: 15_000,
  reference: null,
  paymentId: null,
  providerReference: null,
  createdAt: SALE.occurredAt,
}

const CREDIT: SaleTenderRow = {
  ...CASH,
  method: 'CREDIT',
  amountMinor: 12_000,
}

const CONTEXT: ReceiptContext = {
  branchName: 'Accra - Spintex',
  branchCode: 'ACC-SPX',
  terminalCode: 'ACC-SPX-T01',
  receiptHeader: 'Sceptre Drive',
  receiptFooter: 'Thank you',
}

interface StatePatch {
  status: string
  printedAt?: string | null
  error?: string | null
  incrementReprint?: boolean
}

function fakeStore(
  sale: SaleRow = SALE,
  tenders: SaleTenderRow[] = [CASH],
): { store: SaleStore; states: Array<{ saleId: string; patch: StatePatch }> } {
  const states: Array<{ saleId: string; patch: StatePatch }> = []
  return {
    states,
    store: {
      getSale: async (saleId) => (saleId === sale.id ? sale : null),
      getLines: async () => [LINE],
      getTenders: async () => tenders,
      getContext: async () => CONTEXT,
      getCashierName: async () => 'Ama Mensah',
      getCustomer: async () => null,
      setPrintState: async (saleId, patch) => {
        states.push({ saleId, patch })
      },
    },
  }
}

function fakeTransport(outcome: PrintOutcome = { ok: true, bytes: 123 }): {
  transport: PrinterTransport
  jobs: Array<{ target: PrinterTarget; job: PrintJob }>
  drawers: Array<{ target: PrinterTarget; pin: 2 | 5 }>
} {
  const jobs: Array<{ target: PrinterTarget; job: PrintJob }> = []
  const drawers: Array<{ target: PrinterTarget; pin: 2 | 5 }> = []
  return {
    jobs,
    drawers,
    transport: {
      list: async (): Promise<PrinterInfo[]> => [],
      print: async (target, job) => {
        jobs.push({ target, job })
        return outcome
      },
      openDrawer: async (target, pin) => {
        drawers.push({ target, pin })
        return { ok: true, bytes: 7 }
      },
      test: async () => ({ ok: true, bytes: 7 }),
    },
  }
}

const DEPS = (store: SaleStore, transport: PrinterTransport) => ({
  store,
  transport,
  settings: { ...DEFAULT_PRINTER_SETTINGS, driver: 'fake' as const },
  now: () => new Date('2026-10-23T10:16:00.000Z'),
})

describe('printSale', () => {
  it('prints a cash receipt, kicks the drawer, and marks the sale PRINTED', async () => {
    const { store, states } = fakeStore()
    const { transport, jobs } = fakeTransport()

    const result = await printSale(DEPS(store, transport), SALE.id)

    expect(result.printStatus).toBe('PRINTED')
    expect(result.outcome.ok).toBe(true)
    expect(states.map((state) => state.patch.status)).toEqual(['PRINTING', 'PRINTED'])
    expect(states[1]?.patch.printedAt).toBe('2026-10-23T10:16:00.000Z')
    expect(states[1]?.patch.incrementReprint).toBe(false)

    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.job.openDrawer).toBe(true)
    expect(jobs[0]?.job.receiptNumber).toBe(SALE.receiptNumber)
    expect(jobs[0]?.job.lines.every((line) => line.text.length <= 42)).toBe(true)
    const text = jobs[0]?.job.lines.map((line) => line.text).join('\n')
    expect(text).toContain('ACC-SPX-T01-20261023-0007')
    expect(text).toContain('GHS 120.00')
    expect(text).not.toContain('*** REPRINT ***')
  })

  it('does not kick the drawer for a credit sale', async () => {
    const { store } = fakeStore({ ...SALE, creditAmountMinor: 12_000 }, [CREDIT])
    const { transport, jobs } = fakeTransport()

    await printSale(DEPS(store, transport), SALE.id)
    expect(jobs[0]?.job.openDrawer).toBe(false)
  })

  it('keeps the sale and records FAILED when the printer rejects the job', async () => {
    const { store, states } = fakeStore()
    const { transport } = fakeTransport({
      ok: false,
      code: 'PRINTER_FAILED',
      message: 'The printer did not accept the job',
    })

    const result = await printSale(DEPS(store, transport), SALE.id)

    expect(result.printStatus).toBe('FAILED')
    expect(states.map((state) => state.patch.status)).toEqual(['PRINTING', 'FAILED'])
    expect(states[1]?.patch.error).toContain('PRINTER_FAILED')
    expect(states[1]?.patch.printedAt).toBeNull()
  })

  it('marks a reprint and increments the stored count only on success', async () => {
    const { store, states } = fakeStore()
    const { transport, jobs } = fakeTransport()

    await printSale(DEPS(store, transport), SALE.id, { reprint: true })

    expect(jobs[0]?.job.lines[0]?.text.trim()).toBe('*** REPRINT ***')
    expect(states[1]?.patch.incrementReprint).toBe(true)
  })

  it('uses the configured cedi symbol when the charset supports it', async () => {
    const { store } = fakeStore()
    const { transport, jobs } = fakeTransport()

    await printSale(
      {
        ...DEPS(store, transport),
        settings: {
          ...DEFAULT_PRINTER_SETTINGS,
          driver: 'fake',
          currencySymbol: 'GH₵',
        },
      },
      SALE.id,
    )

    const text = jobs[0]?.job.lines.map((line) => line.text).join('\n')
    expect(text).toContain('GH₵')
  })

  it('fails a missing sale loudly rather than printing a blank receipt', async () => {
    const { store } = fakeStore()
    const { transport } = fakeTransport()
    await expect(printSale(DEPS(store, transport), 'missing')).rejects.toThrow('no longer exists')
  })
})

describe('manual drawer', () => {
  it('sends a standalone kick with the configured pin', async () => {
    const { transport, drawers } = fakeTransport()
    const outcome = await openDrawerNow({
      transport,
      settings: { ...DEFAULT_PRINTER_SETTINGS, driver: 'network', printerHost: '10.0.0.5' },
    })

    expect(outcome.ok).toBe(true)
    expect(drawers[0]).toEqual({
      target: { driver: 'network', host: '10.0.0.5', port: 9100 },
      pin: 2,
    })
  })
})

describe('createSaleStore', () => {
  it('is the production adapter over the local database', () => {
    const db = { getOptional: async () => null, getAll: async () => [] }
    const store = createSaleStore(db as never)
    expect(typeof store.getSale).toBe('function')
    expect(typeof store.setPrintState).toBe('function')
  })
})
