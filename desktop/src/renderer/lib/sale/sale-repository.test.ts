import { describe, expect, it } from 'vitest'
import { SaleDraftError } from './sale-draft'
import type { SqlReader } from './sale-repository'
import { listCartTenders, listSaleTenders } from './sale-repository'

/**
 * Reading a stored tender back.
 *
 * This is the read a reprint and a shift report make, hours after the sale. It
 * used to coerce every method that was not `CREDIT` to `CASH`, so a Phase 13
 * MoMo tender would have printed as cash on a customer's receipt. The parser is
 * the fix, and these cases are why it exists (P13-D1).
 */

const SALE_ID = '55555555-5555-7555-8555-555555555555'

function tenderRow(overrides: Record<string, unknown> = {}) {
  return {
    sale_id: SALE_ID,
    sequence: 1,
    method: 'CASH',
    amount_minor: 4_000,
    reference: null,
    payment_id: null,
    provider_reference: null,
    created_at: '2026-10-27T10:00:00.000Z',
    ...overrides,
  }
}

function reader(rows: unknown[], capture?: (sql: string) => void): SqlReader {
  return {
    getOptional: async () => null,
    getAll: async (sql: string) => {
      capture?.(sql)
      return rows as never[]
    },
  }
}

describe('listSaleTenders', () => {
  it('reads a MoMo tender back as MoMo', async () => {
    const tenders = await listSaleTenders(
      reader([
        tenderRow({ sequence: 1, method: 'CASH', amount_minor: 4_000 }),
        tenderRow({
          sequence: 2,
          method: 'MOMO',
          amount_minor: 8_000,
          payment_id: 'payment-1',
          provider_reference: 'paystack-ref-1',
        }),
      ]),
      SALE_ID,
    )

    expect(tenders.map((tender) => tender.method)).toEqual(['CASH', 'MOMO'])
    expect(tenders[1]?.paymentId).toBe('payment-1')
    expect(tenders[1]?.providerReference).toBe('paystack-ref-1')
  })

  it('orders by sequence, because a split shares one created_at', async () => {
    let sql = ''
    await listSaleTenders(
      reader([], (statement) => {
        sql = statement
      }),
      SALE_ID,
    )
    expect(sql).toContain('ORDER BY COALESCE(sequence, 1), created_at')
  })

  it('throws on a stored method this build does not know', async () => {
    await expect(
      listSaleTenders(reader([tenderRow({ method: 'CHEQUE' })]), SALE_ID),
    ).rejects.toBeInstanceOf(SaleDraftError)
  })

  it('reads a legacy row with no sequence as the first tender', async () => {
    const [tender] = await listSaleTenders(reader([tenderRow({ sequence: null })]), SALE_ID)
    expect(tender?.sequence).toBe(1)
  })
})

describe('listCartTenders', () => {
  it('returns the draft’s in-flight tenders with their payment state', async () => {
    const tenders = await listCartTenders(
      reader(
        [
          tenderRow({
            draft_id: 'draft-1',
            sequence: 1,
            method: 'MOMO',
            status: 'PENDING',
            payment_id: 'payment-1',
            display_text: 'Approve on your phone',
            expires_at: '2026-10-27T10:03:00.000Z',
          }),
        ],
        undefined,
      ),
      'draft-1',
    )

    expect(tenders).toEqual([
      {
        draftId: 'draft-1',
        sequence: 1,
        method: 'MOMO',
        amountMinor: 4_000,
        paymentId: 'payment-1',
        providerReference: null,
        status: 'PENDING',
        displayText: 'Approve on your phone',
        expiresAt: '2026-10-27T10:03:00.000Z',
        createdAt: '2026-10-27T10:00:00.000Z',
      },
    ])
  })
})
