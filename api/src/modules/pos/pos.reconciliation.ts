import { type DbExecutor, db } from '@gikautos/db'
import { type SQL, sql } from 'drizzle-orm'

/**
 * Read-only reconciliation (D33/SYNC-06).
 *
 * Every function re-derives the arithmetic from the stored facts and returns
 * divergences; nothing is auto-corrected. A clean dataset returns empty arrays.
 */

export interface SaleDivergence {
  saleId: string | null
  receiptNumber: string | null
  branchId: string | null
  check: string
  details: Record<string, unknown>
}

export interface ShiftDivergence {
  shiftId: string | null
  number: string | null
  branchId: string | null
  check: string
  details: Record<string, unknown>
}

export interface ReconciliationResult {
  sales: SaleDivergence[]
  shifts: ShiftDivergence[]
}

function branchClause(column: SQL, branchId: string | null | undefined): SQL {
  return branchId ? sql`${column} = ${branchId}` : sql`true`
}

interface RawRow {
  [key: string]: unknown
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function detailsOf(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

async function querySaleChecks(
  check: string,
  executor: DbExecutor,
  query: SQL,
): Promise<SaleDivergence[]> {
  const result = await executor.execute<RawRow>(query)
  return result.rows.map((row) => ({
    saleId: stringOrNull(row.sale_id),
    receiptNumber: stringOrNull(row.receipt_number),
    branchId: stringOrNull(row.branch_id),
    check,
    details: detailsOf(row.details),
  }))
}

/**
 * Proves per sale: header = sum of lines (subtotal, discounts, tax, total),
 * tenders = total + change, credit = one ledger charge, and loyalty = one
 * redemption entry. A deliberately corrupt row is reported, never repaired.
 */
export async function reconcileSales(
  branchId?: string | null,
  executor: DbExecutor = db,
): Promise<SaleDivergence[]> {
  const branch = branchClause(sql`s.branch_id`, branchId)
  const divergences: SaleDivergence[] = []

  divergences.push(
    ...(await querySaleChecks(
      'HEADER_TOTALS',
      executor,
      sql`
        SELECT s.id AS sale_id, s.receipt_number, s.branch_id,
          jsonb_build_object(
            'headerSubtotalMinor', s.subtotal_minor,
            'lineSubtotalMinor', COALESCE(SUM(l.unit_price_minor * l.quantity), 0),
            'headerLineDiscountMinor', s.line_discount_minor,
            'lineDiscountMinor', COALESCE(SUM(l.line_discount_minor), 0),
            'headerSaleDiscountMinor', s.sale_discount_minor,
            'saleDiscountMinor', COALESCE(SUM(l.sale_discount_minor), 0),
            'headerLoyaltyDiscountMinor', s.loyalty_discount_minor,
            'loyaltyDiscountMinor', COALESCE(SUM(l.loyalty_discount_minor), 0),
            'headerVatMinor', s.vat_minor,
            'vatMinor', COALESCE(SUM(l.vat_minor), 0),
            'headerNhilMinor', s.nhil_minor,
            'nhilMinor', COALESCE(SUM(l.nhil_minor), 0),
            'headerGetfundMinor', s.getfund_minor,
            'getfundMinor', COALESCE(SUM(l.getfund_minor), 0),
            'headerTaxTotalMinor', s.tax_total_minor,
            'taxTotalMinor', COALESCE(SUM(l.tax_total_minor), 0),
            'headerTotalMinor', s.total_minor,
            'lineTotalMinor', COALESCE(SUM(l.total_minor), 0)
          ) AS details
        FROM sale s
        LEFT JOIN sale_line l ON l.sale_id = s.id
        WHERE ${branch}
        GROUP BY s.id
        HAVING
          COALESCE(SUM(l.unit_price_minor * l.quantity), 0) <> s.subtotal_minor
          OR COALESCE(SUM(l.line_discount_minor), 0) <> s.line_discount_minor
          OR COALESCE(SUM(l.sale_discount_minor), 0) <> s.sale_discount_minor
          OR COALESCE(SUM(l.loyalty_discount_minor), 0) <> s.loyalty_discount_minor
          OR COALESCE(SUM(l.vat_minor), 0) <> s.vat_minor
          OR COALESCE(SUM(l.nhil_minor), 0) <> s.nhil_minor
          OR COALESCE(SUM(l.getfund_minor), 0) <> s.getfund_minor
          OR COALESCE(SUM(l.tax_total_minor), 0) <> s.tax_total_minor
          OR COALESCE(SUM(l.total_minor), 0) <> s.total_minor
      `,
    )),
  )

  divergences.push(
    ...(await querySaleChecks(
      'TENDER_TOTALS',
      executor,
      sql`
        SELECT s.id AS sale_id, s.receipt_number, s.branch_id,
          jsonb_build_object(
            'tenderTotalMinor', s.tender_total_minor,
            'sumTendersMinor', COALESCE(SUM(t.amount_minor), 0),
            'cashTendersMinor', COALESCE(SUM(t.amount_minor) FILTER (WHERE t.method = 'CASH'), 0),
            'creditTendersMinor', COALESCE(SUM(t.amount_minor) FILTER (WHERE t.method = 'CREDIT'), 0),
            'creditAmountMinor', s.credit_amount_minor,
            'totalMinor', s.total_minor,
            'changeMinor', s.change_minor,
            'tenderCount', COUNT(t.id)
          ) AS details
        FROM sale s
        LEFT JOIN sale_tender t ON t.sale_id = s.id
        WHERE ${branch}
        GROUP BY s.id
        HAVING
          COALESCE(SUM(t.amount_minor), 0) <> s.tender_total_minor
          OR (COUNT(t.id) = 0 AND s.total_minor > 0)
          -- Every tender (cash or credit) less the sale total is the change.
          -- A credit-only sale has no cash leg, so the invariant is the sum of
          -- all tenders, not the cash filter alone.
          OR COALESCE(SUM(t.amount_minor), 0) - s.total_minor <> s.change_minor
          OR COALESCE(SUM(t.amount_minor) FILTER (WHERE t.method = 'CREDIT'), 0) <> s.credit_amount_minor
          OR COALESCE(SUM(t.amount_minor) FILTER (WHERE t.method = 'CASH'), 0)
             - s.change_minor
             + COALESCE(SUM(t.amount_minor) FILTER (WHERE t.method = 'CREDIT'), 0) <> s.total_minor
      `,
    )),
  )

  divergences.push(
    ...(await querySaleChecks(
      'STOCK_MOVEMENTS',
      executor,
      sql`
        WITH expected AS (
          SELECT sl.sale_id, sl.product_id, s.branch_id,
                 SUM(sl.quantity)::int AS quantity,
                 MAX(s.receipt_number) AS receipt_number
          FROM sale_line sl
          JOIN sale s ON s.id = sl.sale_id
          WHERE ${branch}
          GROUP BY sl.sale_id, sl.product_id, s.branch_id
        ), actual AS (
          SELECT sm.reference_id AS sale_id, sm.product_id, SUM(-sm.quantity_delta)::int AS quantity,
                 MAX(sm.reference_number) AS reference_number
          FROM stock_movement sm
          WHERE sm.type = 'SALE' AND sm.reference_type = 'SALE'
            AND ${branchClause(sql`sm.branch_id`, branchId)}
          GROUP BY sm.reference_id, sm.product_id
        )
        SELECT e.sale_id, e.receipt_number, e.branch_id,
          jsonb_build_object(
            'productId', COALESCE(e.product_id, a.product_id),
            'expectedQuantity', e.quantity,
            'movementQuantity', a.quantity,
            'movementReceiptNumber', a.reference_number
          ) AS details
        FROM expected e
        FULL OUTER JOIN actual a ON a.sale_id = e.sale_id AND a.product_id = e.product_id
        WHERE e.sale_id IS NULL OR a.sale_id IS NULL
          OR a.quantity <> e.quantity
          OR a.reference_number IS DISTINCT FROM e.receipt_number
      `,
    )),
  )

  divergences.push(
    ...(await querySaleChecks(
      'CREDIT_ENTRY',
      executor,
      sql`
        SELECT s.id AS sale_id, s.receipt_number, s.branch_id,
          jsonb_build_object(
            'creditAmountMinor', s.credit_amount_minor,
            'entryCount', COUNT(e.id),
            'entryAmountMinor', COALESCE(SUM(e.amount_minor), 0),
            'referenceMatches', BOOL_AND(e.reference_number IS NOT DISTINCT FROM s.receipt_number)
          ) AS details
        FROM sale s
        LEFT JOIN credit_ledger_entry e
          ON e.reference_id = s.id AND e.reference_type = 'SALE' AND e.kind = 'CHARGE'
        WHERE s.credit_amount_minor > 0 AND ${branch}
        GROUP BY s.id
        HAVING
          COUNT(e.id) <> 1
          OR COALESCE(SUM(e.amount_minor), 0) <> s.credit_amount_minor
          OR NOT BOOL_AND(e.reference_number IS NOT DISTINCT FROM s.receipt_number)
      `,
    )),
  )

  divergences.push(
    ...(await querySaleChecks(
      'LOYALTY_REDEMPTION',
      executor,
      sql`
        SELECT s.id AS sale_id, s.receipt_number, s.branch_id,
          jsonb_build_object(
            'redeemPoints', s.loyalty_redeem_points,
            'loyaltyDiscountMinor', s.loyalty_discount_minor,
            'entryCount', COUNT(e.id),
            'entryPoints', COALESCE(SUM(e.points_delta), 0)
          ) AS details
        FROM sale s
        LEFT JOIN loyalty_ledger_entry e
          ON e.reference_id = s.id AND e.reference_type = 'SALE' AND e.kind = 'REDEEM'
        WHERE s.loyalty_redeem_points > 0 AND ${branch}
        GROUP BY s.id
        HAVING
          COUNT(e.id) <> 1
          OR COALESCE(SUM(e.points_delta), 0) <> -s.loyalty_redeem_points
          OR s.loyalty_discount_minor = 0
      `,
    )),
  )

  return divergences
}

/**
 * Proves per shift: expected cash = float + cash tenders − change + in − out,
 * variance = counted − expected, and OPEN/CLOSED fields agree with the status.
 */
export async function reconcileShifts(
  branchId?: string | null,
  executor: DbExecutor = db,
): Promise<ShiftDivergence[]> {
  const branch = branchClause(sql`sh.branch_id`, branchId)
  const result = await executor.execute<RawRow>(sql`
    WITH cash AS (
      SELECT sh.id, sh.number, sh.branch_id, sh.status,
             sh.opening_float_minor, sh.counted_cash_minor,
             sh.server_expected_cash_minor, sh.variance_minor,
             COALESCE((
               SELECT SUM(t.amount_minor) FROM sale_tender t
               JOIN sale s ON s.id = t.sale_id
               WHERE s.shift_id = sh.id AND t.method = 'CASH'
             ), 0)::int AS cash_tenders,
             COALESCE((SELECT SUM(s.change_minor) FROM sale s WHERE s.shift_id = sh.id), 0)::int AS change_total,
             COALESCE((
               SELECT SUM(cm.amount_minor) FROM cash_movement cm
               WHERE cm.shift_id = sh.id AND cm.type = 'CASH_IN'
             ), 0)::int AS cash_in,
             COALESCE((
               SELECT SUM(cm.amount_minor) FROM cash_movement cm
               WHERE cm.shift_id = sh.id AND cm.type = 'CASH_OUT'
             ), 0)::int AS cash_out
      FROM shift sh
      WHERE ${branch}
    )
    SELECT id AS shift_id, number, branch_id,
      jsonb_build_object(
        'status', status,
        'openingFloatMinor', opening_float_minor,
        'cashTendersMinor', cash_tenders,
        'changeMinor', change_total,
        'cashInMinor', cash_in,
        'cashOutMinor', cash_out,
        'serverExpectedCashMinor', server_expected_cash_minor,
        'countedCashMinor', counted_cash_minor,
        'varianceMinor', variance_minor,
        'recomputedExpectedMinor',
          opening_float_minor + cash_tenders - change_total + cash_in - cash_out
      ) AS details
    FROM cash
    WHERE
      (status = 'CLOSED'
        AND (
          server_expected_cash_minor IS DISTINCT FROM
            (opening_float_minor + cash_tenders - change_total + cash_in - cash_out)
          OR variance_minor IS DISTINCT FROM (counted_cash_minor - server_expected_cash_minor)
        ))
      OR (status = 'OPEN'
        AND (counted_cash_minor IS NOT NULL OR server_expected_cash_minor IS NOT NULL
             OR variance_minor IS NOT NULL))
  `)

  const divergences: ShiftDivergence[] = result.rows.map((row) => ({
    shiftId: stringOrNull(row.shift_id),
    number: stringOrNull(row.number),
    branchId: stringOrNull(row.branch_id),
    check: 'EXPECTED_CASH',
    details: detailsOf(row.details),
  }))

  const openPerTerminal = await executor.execute<RawRow>(sql`
    SELECT sh.terminal_id, sh.branch_id, COUNT(*)::int AS open_shifts
    FROM shift sh
    WHERE sh.status = 'OPEN' AND ${branch}
    GROUP BY sh.terminal_id, sh.branch_id
    HAVING COUNT(*) > 1
  `)
  for (const row of openPerTerminal.rows) {
    divergences.push({
      shiftId: null,
      number: null,
      branchId: stringOrNull(row.branch_id),
      check: 'ONE_OPEN_PER_TERMINAL',
      details: {
        terminalId: stringOrNull(row.terminal_id),
        openShifts: row.open_shifts,
      },
    })
  }

  return divergences
}

export async function reconcilePos(
  branchId?: string | null,
  executor: DbExecutor = db,
): Promise<ReconciliationResult> {
  const [sales, shifts] = await Promise.all([
    reconcileSales(branchId, executor),
    reconcileShifts(branchId, executor),
  ])
  return { sales, shifts }
}
