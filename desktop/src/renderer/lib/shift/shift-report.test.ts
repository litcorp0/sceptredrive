import { describe, expect, it } from 'vitest'
import {
  type LocalShiftReport,
  localShiftReport,
  readShiftFigures,
  writeShiftReport,
} from './shift-report'
import type { LocalShift, SqlReader } from './shift-repository'

/**
 * The local Z snapshot (P13-D32).
 *
 * The figures are the server's field-for-field shape read from the till's rows,
 * and the stored row must equal the recomputation — the same assertion the
 * phase's verification makes against the database, at the unit level.
 */

const SHIFT: LocalShift = {
  id: 'shift-1',
  number: 'ACC-SPX-T01-S-20261027-01',
  branchId: 'branch-1',
  terminalId: 'terminal-1',
  deviceId: 'device-1',
  cashierUserId: 'user-cashier',
  cashierStaffId: 'SD-0003',
  status: 'CLOSED',
  openedAt: '2026-10-27T08:00:00.000Z',
  closedAt: '2026-10-27T18:30:00.000Z',
  openingFloatMinor: 20_000,
  countedCashMinor: 51_500,
  clientExpectedCashMinor: 52_000,
  closeNote: null,
  openedBy: 'SD-0003',
  closedBy: 'SD-0003',
  createdAt: '2026-10-27T08:00:00.000Z',
}

const FIGURES_ROW: Record<string, number> = {
  sale_count: 3,
  item_count: 7,
  refund_count: 1,
  void_count: 2,
  gross_minor: 45_000,
  refund_minor: 5_000,
  line_discount_minor: 0,
  sale_discount_minor: 1_000,
  loyalty_discount_minor: 500,
  loyalty_redeem_points: 100,
  loyalty_earned_points: 30,
  base_minor: 36_250,
  vat_minor: 5_437,
  nhil_minor: 906,
  getfund_minor: 906,
  tax_total_minor: 7_249,
  cash_minor: 30_000,
  credit_minor: 5_000,
  momo_minor: 10_000,
  card_minor: 0,
  bank_transfer_minor: 0,
  change_minor: 2_000,
  cash_in_minor: 5_000,
  cash_out_minor: 1_000,
  cash_refunds_minor: 7_500,
  cash_repayments_minor: 15_000,
}

const COLUMN_FIELD: Record<string, keyof LocalShiftReport> = {
  id: 'shiftId',
  shift_id: 'shiftId',
  branch_id: 'branchId',
  terminal_id: 'terminalId',
  device_id: 'deviceId',
  number: 'number',
  opened_at: 'openedAt',
  closed_at: 'closedAt',
  opening_float_minor: 'openingFloatMinor',
  sale_count: 'saleCount',
  item_count: 'itemCount',
  refund_count: 'refundCount',
  void_count: 'voidCount',
  gross_minor: 'grossMinor',
  refund_minor: 'refundMinor',
  net_minor: 'netMinor',
  line_discount_minor: 'lineDiscountMinor',
  sale_discount_minor: 'saleDiscountMinor',
  loyalty_discount_minor: 'loyaltyDiscountMinor',
  loyalty_redeem_points: 'loyaltyRedeemPoints',
  loyalty_earned_points: 'loyaltyEarnedPoints',
  base_minor: 'baseMinor',
  vat_minor: 'vatMinor',
  nhil_minor: 'nhilMinor',
  getfund_minor: 'getfundMinor',
  tax_total_minor: 'taxTotalMinor',
  cash_minor: 'cashMinor',
  credit_minor: 'creditMinor',
  momo_minor: 'momoMinor',
  card_minor: 'cardMinor',
  bank_transfer_minor: 'bankTransferMinor',
  change_minor: 'changeMinor',
  cash_in_minor: 'cashInMinor',
  cash_out_minor: 'cashOutMinor',
  cash_repayment_minor: 'cashRepaymentMinor',
  expected_cash_minor: 'expectedCashMinor',
  counted_cash_minor: 'countedCashMinor',
  variance_minor: 'varianceMinor',
  created_at: 'generatedAt',
}

async function figures() {
  return readShiftFigures(reader(FIGURES_ROW), SHIFT.id)
}

/** A reader whose one row is whatever the caller says the SQL returned. */
function reader(row: Record<string, number> | null): SqlReader {
  return {
    getOptional: async <T>(_sql: string, _parameters?: unknown[]): Promise<T | null> =>
      row as T | null,
  }
}

describe('readShiftFigures', () => {
  it('reads every aggregate in one query, keyed by the shift', async () => {
    let parameters: unknown[] | undefined
    const result = await readShiftFigures(
      {
        getOptional: async <T>(_sql: string, params?: unknown[]): Promise<T | null> => {
          parameters = params
          return FIGURES_ROW as T
        },
      },
      SHIFT.id,
    )

    expect(result).toEqual({
      saleCount: 3,
      itemCount: 7,
      refundCount: 1,
      voidCount: 2,
      grossMinor: 45_000,
      refundMinor: 5_000,
      lineDiscountMinor: 0,
      saleDiscountMinor: 1_000,
      loyaltyDiscountMinor: 500,
      loyaltyRedeemPoints: 100,
      loyaltyEarnedPoints: 30,
      baseMinor: 36_250,
      vatMinor: 5_437,
      nhilMinor: 906,
      getfundMinor: 906,
      taxTotalMinor: 7_249,
      cashMinor: 30_000,
      creditMinor: 5_000,
      momoMinor: 10_000,
      cardMinor: 0,
      bankTransferMinor: 0,
      changeMinor: 2_000,
      cashInMinor: 5_000,
      cashOutMinor: 1_000,
      cashRefundsMinor: 7_500,
      cashRepaymentsMinor: 15_000,
    })
    // Every placeholder is the shift: a figure can never leak across shifts.
    expect(parameters).toEqual(Array.from({ length: 26 }, () => SHIFT.id))
  })

  it('treats a missing row as zero rather than undefined money', async () => {
    const result = await readShiftFigures({ getOptional: async () => null }, SHIFT.id)
    expect(result.grossMinor).toBe(0)
    expect(result.saleCount).toBe(0)
    expect(result.cashRefundsMinor).toBe(0)
  })

  it('reads cash refunds from the refund tender of the shift that paid them', async () => {
    let sql = ''
    await readShiftFigures(
      {
        getOptional: async <T>(statement: string): Promise<T | null> => {
          sql = statement
          return FIGURES_ROW as T
        },
      },
      SHIFT.id,
    )

    expect(sql).toContain('FROM refund_tender rt')
    expect(sql).toContain('JOIN refund r ON r.id = rt.refund_id')
    // The refund's own shift: that is the drawer the money left.
    expect(sql).toContain('r.shift_id = ?')
    expect(sql).toContain("rt.method = 'CASH'")
    expect(sql).toContain("rt.status = 'SETTLED'")
  })
})

describe('localShiftReport', () => {
  it('computes net, the drawer and the variance from the shift row', async () => {
    const report = localShiftReport(SHIFT, await figures(), 52_000, '2026-10-27T18:30:00.000Z')

    expect(report.netMinor).toBe(40_000)
    expect(report.openingFloatMinor).toBe(20_000)
    expect(report.expectedCashMinor).toBe(52_000)
    expect(report.countedCashMinor).toBe(51_500)
    expect(report.varianceMinor).toBe(-500)
    expect(report.closedAt).toBe('2026-10-27T18:30:00.000Z')
  })

  it('falls back to the generation time when a shift never recorded a close', async () => {
    const report = localShiftReport(
      { ...SHIFT, closedAt: null, countedCashMinor: null },
      await figures(),
      52_000,
      '2026-10-27T19:00:00.000Z',
    )
    expect(report.closedAt).toBe('2026-10-27T19:00:00.000Z')
    expect(report.countedCashMinor).toBe(0)
  })
})

describe('writeShiftReport', () => {
  it('stores exactly the recomputed row, column for column', async () => {
    let sql = ''
    let parameters: unknown[] | undefined
    const report = localShiftReport(SHIFT, await figures(), 52_000, '2026-10-27T18:30:00.000Z')

    await writeShiftReport(
      {
        execute: async (statement: string, params?: unknown[]) => {
          sql = statement
          parameters = params
          return undefined
        },
      } as never,
      report,
    )

    const columns = /\(([^)]+)\)\s*VALUES/s
      .exec(sql)?.[1]
      ?.split(',')
      .map((column) => column.trim())
    expect(columns).toBeDefined()
    expect(parameters).toHaveLength(columns?.length ?? 0)

    // A placeholder-to-column mismatch is a runtime SQLite error even when the
    // parameter array has the right length; assert the statement itself.
    const placeholders = /VALUES\s*\(([\s\S]*?)\)/.exec(sql)?.[1]?.match(/\?/g) ?? []
    expect(placeholders).toHaveLength(columns?.length ?? 0)

    const stored: Record<string, unknown> = {}
    for (const [index, column] of (columns ?? []).entries()) {
      stored[column] = parameters?.[index]
    }

    for (const [column, value] of Object.entries(stored)) {
      const field = COLUMN_FIELD[column]
      expect(field, `no field mapped for ${column}`).toBeDefined()
      if (!field) continue
      expect(value, column).toEqual(report[field])
    }
    expect(stored.created_at).toBe('2026-10-27T18:30:00.000Z')
  })
})
