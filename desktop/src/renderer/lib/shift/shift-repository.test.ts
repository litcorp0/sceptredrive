import { describe, expect, it } from 'vitest'
import { type SqlReader, selectShiftCashTotals } from './shift-repository'
import { computeExpectedCash } from './shift-service'

/**
 * The drawer totals the expected-cash formula reads.
 *
 * A settled cash refund is money that left the drawer, so it has to come off
 * the shift that paid it — the **refund's** shift, not the sale's. The fixture
 * deliberately holds three refunds that must never reduce this drawer: a
 * pending cash refund (the money is not out yet), a settled card refund (it
 * never touched the notes), and a cash refund paid by another shift.
 */

const SHIFT_ID = 'shift-1'
const OTHER_SHIFT_ID = 'shift-2'
const OPENING_FLOAT_MINOR = 20_000

interface Fixture {
  cashTendersMinor: number
  changeMinor: number
  cashInMinor: number
  cashOutMinor: number
  /** refund id → the shift whose drawer paid it. */
  refunds: Map<string, string>
  refundTenders: {
    refundId: string
    method: string
    status: string
    amountMinor: number
  }[]
}

const FIXTURE: Fixture = {
  cashTendersMinor: 180_000,
  changeMinor: 0,
  cashInMinor: 10_000,
  cashOutMinor: 0,
  refunds: new Map([
    ['refund-cash', SHIFT_ID],
    ['refund-cash-pending', SHIFT_ID],
    ['refund-card', SHIFT_ID],
    ['refund-other-shift', OTHER_SHIFT_ID],
  ]),
  refundTenders: [
    { refundId: 'refund-cash', method: 'CASH', status: 'SETTLED', amountMinor: 50_000 },
    { refundId: 'refund-cash-pending', method: 'CASH', status: 'PENDING', amountMinor: 25_000 },
    { refundId: 'refund-card', method: 'CARD', status: 'SETTLED', amountMinor: 30_000 },
    { refundId: 'refund-other-shift', method: 'CASH', status: 'SETTLED', amountMinor: 70_000 },
  ],
}

interface Query {
  sql: string
  parameters: unknown[] | undefined
}

/**
 * Answers the one totals statement from the fixture, applying a predicate only
 * when the SQL asks for it — so a missing `CASH` or `SETTLED` filter surfaces as
 * a wrong number rather than passing unnoticed.
 */
function fakeReader(fixture: Fixture = FIXTURE): { reader: SqlReader; queries: Query[] } {
  const queries: Query[] = []
  return {
    queries,
    reader: {
      getOptional: async <T>(sql: string, parameters?: unknown[]) => {
        queries.push({ sql, parameters })
        const cashOnly = sql.includes("rt.method = 'CASH'")
        const settledOnly = sql.includes("rt.status = 'SETTLED'")
        const cashRefundsMinor = fixture.refundTenders
          .filter((tender) => fixture.refunds.get(tender.refundId) === SHIFT_ID)
          .filter((tender) => !cashOnly || tender.method === 'CASH')
          .filter((tender) => !settledOnly || tender.status === 'SETTLED')
          .reduce((sum, tender) => sum + tender.amountMinor, 0)

        return {
          cash_tenders: fixture.cashTendersMinor,
          change_total: fixture.changeMinor,
          cash_in: fixture.cashInMinor,
          cash_out: fixture.cashOutMinor,
          cash_refunds: cashRefundsMinor,
        } as T
      },
    },
  }
}

describe('selectShiftCashTotals', () => {
  it('subtracts only this shift’s settled cash refunds', async () => {
    const { reader, queries } = fakeReader()

    const totals = await selectShiftCashTotals(reader, SHIFT_ID, OPENING_FLOAT_MINOR)

    expect(totals).toEqual({
      openingFloatMinor: OPENING_FLOAT_MINOR,
      cashTendersMinor: 180_000,
      changeMinor: 0,
      cashInMinor: 10_000,
      cashOutMinor: 0,
      cashRefundsMinor: 50_000,
    })
    // float + cash tenders − change + cash in − cash out − cash refunds.
    // The pending, card, and other-shift refunds are absent because none of
    // them emptied this drawer.
    expect(computeExpectedCash(totals)).toBe(160_000)
    // One placeholder per subquery, all the shift: no figure crosses drawers.
    expect(queries[0]?.parameters).toEqual(Array.from({ length: 5 }, () => SHIFT_ID))
  })

  it('joins the refund to its own shift and filters cash, settled tenders', async () => {
    const { reader, queries } = fakeReader()

    await selectShiftCashTotals(reader, SHIFT_ID, 0)

    const sql = queries[0]?.sql ?? ''
    expect(sql).toContain('FROM refund_tender rt')
    expect(sql).toContain('JOIN refund r ON r.id = rt.refund_id')
    expect(sql).toContain('r.shift_id = ?')
    expect(sql).toContain("rt.method = 'CASH'")
    expect(sql).toContain("rt.status = 'SETTLED'")
  })

  it('treats a missing row as zero refunds rather than undefined money', async () => {
    const totals = await selectShiftCashTotals({ getOptional: async () => null }, SHIFT_ID, 0)
    expect(totals.cashRefundsMinor).toBe(0)
    expect(totals.cashTendersMinor).toBe(0)
  })
})
