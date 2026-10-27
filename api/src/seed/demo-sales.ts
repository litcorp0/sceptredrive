import { randomBytes } from 'node:crypto'
import { db } from '@sceptre/db'
import {
  accraIsoDay,
  type PricedCart,
  priceCart,
  type TaxCategory,
  type TaxMode,
} from '@sceptre/shared'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { creditProfile } from '../modules/credit/credit.schema.ts'
import { customer } from '../modules/customers/customers.schema.ts'
import { user } from '../modules/identity/staff.schema.ts'
import { loyaltyAccount } from '../modules/loyalty/loyalty.schema.ts'
import { earnPointsForSale, pointsToValueMinor } from '../modules/loyalty/loyalty.service.ts'
import { hashDeviceToken } from '../modules/org/enrollment.service.ts'
import { terminal } from '../modules/org/terminals.schema.ts'
import { getSettingValue } from '../modules/platform/settings.service.ts'
import { posStaffBinding, sale, shift } from '../modules/pos/pos.schema.ts'
import {
  applySale,
  closeShift,
  computeExpectedCash,
  openShift,
} from '../modules/pos/pos.service.ts'
import type { SaleContext, SalePayload, SaleTotalsPayload } from '../modules/pos/pos.types.ts'
import { product } from '../modules/products/products.schema.ts'
import type { DeviceAuthContext } from '../modules/sync/sync.types.ts'
import { DEMO_PRODUCTS } from './demo.ts'
import {
  creditExposureByCustomerBranch,
  DEMO_SALES_BRANCHES,
  type DemoPlanBranch,
  type DemoPlanCustomer,
  type DemoPlanProduct,
  demoCreditLimits,
  type PlannedSale,
  planDemoCounts,
  planDemoSales,
  plannedUnitsByBranchProduct,
} from './demo-sales.plan.ts'
import {
  createUserWithCredential,
  ensureBranch,
  ensureDemoCountHistory,
  ensureDevice,
  ensureStockReceipt,
  ensureTerminal,
  hashSeedPassword,
} from './helpers.ts'

/**
 * `seed:demo-sales` — six weeks of trading written through `applySale`, plus the
 * posted stock-count history Phase 12's accuracy and rotation views read.
 *
 * Direct inserts would satisfy the charts and break the promise that the dashboard
 * reconciles to the ledgers, so every sale goes through the same service the POS uploads
 * use. Stock movements, the credit charge, the loyalty earn/redeem, the sale lines, and
 * the shift totals are therefore written by the owning rules in one transaction. The
 * counts are posted the same way: the variance goes through `postMovements`, so the
 * branch's movement ledger still sums to its stock levels.
 *
 * Idempotent by receipt prefix: if any `DEMO-%` sale exists the run writes no sales and
 * says so. It never deletes rows to make room. The count history is written before that
 * guard, because it is separate evidence and idempotent by count number — a database
 * that already holds the demo month still gets its counts.
 *
 * Refuses production (`NODE_ENV=production`), exactly like `seed/run.ts`.
 *
 * A shift the operator left open on one of the demo terminals is refused by `openShift`
 * (one open shift per terminal); close it on the POS first. A shift this seed already
 * opened is resumed rather than duplicated, so a run that failed before its first sale can
 * be retried.
 */

const DEMO_RECEIPT_PREFIX = 'DEMO-'
const DEMO_DEVICE_PREFIX = 'demo-sales-'
const DEMO_PASSWORD_DEFAULT = 'demo-password-1234'
const DEMO_PIN = '2468'
const OPENING_FLOAT_MINOR = 20_000
const BINDING_TTL_MS = 90 * 86_400_000
const DAY_MS = 86_400_000

/** The demo customers `demo.ts` creates, addressed by their fixture phone numbers. */
const DEMO_CREDIT_PHONE = '+233241000001'
const DEMO_LOYALTY_PHONE = '+233241000002'

export interface DemoSalesBranchFixture extends DemoPlanBranch {
  /** An existing cashier for this branch; one is created when absent. */
  cashier?: { userId: string; staffId: string }
}

export interface DemoSalesProductFixture {
  id: string
  sku: string
  priceMinor: number
  costMinor: number
  taxCategory: TaxCategory
}

export interface SeedDemoSalesOptions {
  /** Accra day the plan ends on; defaults to today. */
  endDay?: string
  days?: number
  seed?: number
  branches?: DemoSalesBranchFixture[]
  products?: DemoSalesProductFixture[]
  creditCustomerIds?: string[]
  loyaltyCustomerIds?: string[]
  /** Skip the opening-stock receipts when the caller already owns the stock. */
  ensureStock?: boolean
}

export interface SeedDemoSalesResult {
  created: string[]
  sales: number
  shifts: number
}

interface TerminalContext {
  device: DeviceAuthContext
  cashier: { userId: string; staffId: string; pinVersion: number }
  binding: { bindingId: string; bindingToken: string }
}

interface CashierIdentity {
  userId: string
  staffId: string
  pinVersion: number
}

/** Creates one demo cashier for a branch that has none; a cross-branch binding is refused. */
async function ensureBranchCashier(
  branchId: string,
  branchCode: string,
  created: string[],
): Promise<CashierIdentity> {
  const existing = await db
    .select({ id: user.id, staffId: user.staffId, pinVersion: user.pinVersion })
    .from(user)
    .where(and(eq(user.role, 'CASHIER'), eq(user.branchId, branchId), eq(user.isActive, true)))
    .limit(1)
  const found = existing[0]
  if (found?.staffId) {
    return { userId: found.id, staffId: found.staffId, pinVersion: found.pinVersion }
  }

  const email = `cashier.${branchCode.toLowerCase().replace(/[^a-z0-9]+/g, '-')}@sceptre.local`
  const password = process.env.DEMO_PASSWORD ?? DEMO_PASSWORD_DEFAULT
  const pinHash = await hashSeedPassword(DEMO_PIN)

  const identity = await db.transaction(async (tx) => {
    const row = await createUserWithCredential(tx, {
      email,
      name: `Demo Cashier ${branchCode}`,
      password,
      role: 'CASHIER',
      branchId,
      mustChangePassword: true,
    })
    await tx.update(user).set({ pinHash, pinVersion: 1 }).where(eq(user.id, row.id))
    return { userId: row.id, staffId: row.staffId, pinVersion: 1 }
  })

  created.push(`cashier ${email}`)
  return identity
}

/**
 * One live binding per demo device. Any previous binding on our own device is revoked
 * first so this process knows the raw token and every sale validates its credentials.
 */
async function ensureBinding(
  branchId: string,
  deviceId: string,
  cashier: CashierIdentity,
  created: string[],
): Promise<{ bindingId: string; bindingToken: string }> {
  const bindingToken = randomBytes(32).toString('base64url')

  const bindingId = await db.transaction(async (tx) => {
    await tx
      .update(posStaffBinding)
      .set({ revokedAt: new Date(), revokedBy: 'seed' })
      .where(
        and(
          eq(posStaffBinding.deviceId, deviceId),
          eq(posStaffBinding.staffUserId, cashier.userId),
          isNull(posStaffBinding.revokedAt),
        ),
      )
    const rows = await tx
      .insert(posStaffBinding)
      .values({
        deviceId,
        staffUserId: cashier.userId,
        staffStaffId: cashier.staffId,
        role: 'CASHIER',
        branchId,
        pinVersion: cashier.pinVersion,
        bindingTokenHash: hashDeviceToken(bindingToken),
        expiresAt: new Date(Date.now() + BINDING_TTL_MS),
      })
      .returning({ id: posStaffBinding.id })
    const row = rows[0]
    if (!row) throw new Error('Could not create a demo staff binding')
    return row.id
  })

  created.push('staff binding')
  return { bindingId, bindingToken }
}

function totalsPayload(priced: PricedCart, changeMinor: number): SaleTotalsPayload {
  return {
    subtotalMinor: priced.subtotalMinor,
    lineDiscountMinor: priced.lineDiscountMinor,
    saleDiscountMinor: priced.saleDiscountMinor,
    loyaltyDiscountMinor: priced.loyaltyDiscountMinor,
    vatMinor: priced.vatMinor,
    nhilMinor: priced.nhilMinor,
    getfundMinor: priced.getfundMinor,
    taxTotalMinor: priced.taxTotalMinor,
    totalMinor: priced.totalMinor,
    changeMinor,
  }
}

async function resolveDemoProducts(
  options: SeedDemoSalesOptions,
): Promise<DemoSalesProductFixture[]> {
  if (options.products) return options.products

  const skus = DEMO_PRODUCTS.map((item) => item.sku)
  const rows = await db
    .select({
      id: product.id,
      sku: product.sku,
      basePriceMinor: product.basePriceMinor,
      costPriceMinor: product.costPriceMinor,
      taxCategory: product.taxCategory,
    })
    .from(product)
    .where(inArray(product.sku, skus))
  const bySku = new Map(rows.map((row) => [row.sku, row]))

  const resolved: DemoSalesProductFixture[] = []
  for (const item of DEMO_PRODUCTS) {
    const row = bySku.get(item.sku)
    if (!row) {
      throw new Error(
        `${item.sku} is missing; run \`bun run db:seed -- --demo\` before \`seed:demo-sales\``,
      )
    }
    resolved.push({
      id: row.id,
      sku: row.sku,
      priceMinor: row.basePriceMinor,
      costMinor: row.costPriceMinor,
      taxCategory: row.taxCategory as TaxCategory,
    })
  }
  return resolved
}

async function resolveDemoCustomers(
  options: SeedDemoSalesOptions,
): Promise<{ credit: string[]; loyalty: string[] }> {
  if (options.creditCustomerIds || options.loyaltyCustomerIds) {
    return {
      credit: options.creditCustomerIds ?? [],
      loyalty: options.loyaltyCustomerIds ?? [],
    }
  }

  const rows = await db
    .select({ id: customer.id, phone: customer.phone })
    .from(customer)
    .where(inArray(customer.phone, [DEMO_CREDIT_PHONE, DEMO_LOYALTY_PHONE]))
  const byPhone = new Map(rows.map((row) => [row.phone, row.id]))

  const creditId = byPhone.get(DEMO_CREDIT_PHONE)
  const loyaltyId = byPhone.get(DEMO_LOYALTY_PHONE)
  if (!creditId || !loyaltyId) {
    throw new Error(
      'the demo customers are missing; run `bun run db:seed -- --demo` before `seed:demo-sales`',
    )
  }
  return { credit: [creditId], loyalty: [loyaltyId] }
}

export async function seedDemoSales(
  options: SeedDemoSalesOptions = {},
): Promise<SeedDemoSalesResult> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The demo-sales seed refuses to run with NODE_ENV=production')
  }

  const result: SeedDemoSalesResult = { created: [], sales: 0, shifts: 0 }

  const endDay = options.endDay ?? accraIsoDay()
  const days = options.days ?? 42
  const seed = options.seed ?? 20261024

  const products = await resolveDemoProducts(options)
  const customers = await resolveDemoCustomers(options)
  const taxMode = (await getSettingValue('pricing.taxMode', {})) as TaxMode
  const pointsPerCedi = await getSettingValue('loyalty.pointsPerCedi', {})

  // 1. Branches and terminals, matched by code. Only missing rows are created.
  const branchFixtures: DemoSalesBranchFixture[] =
    options.branches ?? DEMO_SALES_BRANCHES.map((fixture) => ({ ...fixture }))
  const branches: Array<{ fixture: DemoSalesBranchFixture; id: string }> = []
  for (const fixture of branchFixtures) {
    const row = await ensureBranch({
      code: fixture.code,
      name: fixture.name,
      type: 'RETAIL',
      city: fixture.city,
    })
    if (row.created) result.created.push(`branch ${fixture.code}`)
    for (const terminalCode of fixture.terminals) {
      const terminalCreated = await ensureTerminal({
        branchId: row.id,
        code: terminalCode,
        name: terminalCode,
      })
      if (terminalCreated) result.created.push(`terminal ${terminalCode}`)
    }
    branches.push({ fixture, id: row.id })
  }

  // 2. The plan (pure), then the stock and count history its numbers need.
  const planCustomers: DemoPlanCustomer[] = [
    ...customers.credit.map((id) => ({ id, kind: 'CREDIT' as const, loyalty: false })),
    ...customers.loyalty.map((id) => ({ id, kind: 'CASH' as const, loyalty: true })),
  ]
  const planProducts: DemoPlanProduct[] = products.map((row) => ({
    id: row.id,
    priceMinor: row.priceMinor,
    costMinor: row.costMinor,
    taxCategory: row.taxCategory,
  }))
  const planBranches: DemoPlanBranch[] = branchFixtures.map((branch) => ({
    code: branch.code,
    name: branch.name,
    city: branch.city,
    terminals: branch.terminals,
  }))

  const plan = planDemoSales({
    endDay,
    days,
    seed,
    branches: planBranches,
    products: planProducts,
    customers: planCustomers,
  })

  if (options.ensureStock !== false) {
    const units = plannedUnitsByBranchProduct(plan)
    const stockDay = new Date(`${endDay}T00:00:00.000Z`).getTime() - days * DAY_MS
    for (const branch of branches) {
      const lines = products.map((row) => {
        const planned = units.get(`${branch.fixture.code}:${row.id}`) ?? 0
        // 150% of planned units plus a buffer keeps the demo free of STOCK_OVERSELL
        // conflicts while staying small enough to post as one receipt.
        return {
          productId: row.id,
          quantity: Math.max(20, Math.ceil(planned * 1.5) + 20),
          unitCostMinor: row.costMinor,
        }
      })
      const stockCreated = await ensureStockReceipt({
        number: `DEMO-GRN-${branch.fixture.code}`,
        branchId: branch.id,
        supplierName: 'Demo Sales Opening Stock',
        note: 'Opening stock for the demo month',
        createdAt: new Date(stockDay),
        lines,
      })
      if (stockCreated) result.created.push(`opening stock ${branch.fixture.code}`)
    }
  }

  /**
   * The count history is posted before the sale guard: a database that already
   * holds the demo month still needs the counts the console and ROTATION read,
   * and the step is idempotent by count number. It runs after the stock receipt
   * so every snapshot has a level row to freeze.
   */
  const branchIdByCode = new Map(branches.map((entry) => [entry.fixture.code, entry.id]))
  const countProductIds = products.map((row) => row.id).sort()
  for (const fixture of branchFixtures) {
    const branchId = branchIdByCode.get(fixture.code)
    if (!branchId) continue
    const plannedCounts = planDemoCounts({
      branchCode: fixture.code,
      endDay,
      productIds: countProductIds,
      seed,
    })
    for (const planned of plannedCounts) {
      const countCreated = await ensureDemoCountHistory({
        number: planned.number,
        branchId,
        dueAt: planned.dueAt,
        postedAt: new Date(planned.postedAt),
        lines: planned.lines,
      })
      if (countCreated) result.created.push(`stock count ${planned.number}`)
    }
  }

  // Idempotent by receipt prefix: the demo month is written once.
  const [existing] = await db
    .select({ count: sql<number>`count(*)`.mapWith(Number) })
    .from(sale)
    .where(sql`${sale.receiptNumber} LIKE ${`${DEMO_RECEIPT_PREFIX}%`}`)
  if ((existing?.count ?? 0) > 0) return result

  // 3. One device, cashier, and live binding per terminal.
  const terminals = new Map<string, TerminalContext>()
  for (const branch of branches) {
    const cashier = branch.fixture.cashier
      ? {
          ...branch.fixture.cashier,
          pinVersion:
            (
              await db
                .select({ pinVersion: user.pinVersion })
                .from(user)
                .where(eq(user.id, branch.fixture.cashier.userId))
                .limit(1)
            )[0]?.pinVersion ?? 1,
        }
      : await ensureBranchCashier(branch.id, branch.fixture.code, result.created)

    for (const terminalCode of branch.fixture.terminals) {
      const rows = await db
        .select({ id: terminal.id })
        .from(terminal)
        .where(eq(terminal.code, terminalCode))
        .limit(1)
      const terminalId = rows[0]?.id
      if (!terminalId) throw new Error(`terminal ${terminalCode} was not created`)

      const demoDevice = await ensureDevice({
        terminalId,
        fingerprint: `${DEMO_DEVICE_PREFIX}${terminalCode}`,
      })
      if (demoDevice.created) result.created.push(`device ${terminalCode}`)

      const binding = await ensureBinding(branch.id, demoDevice.id, cashier, result.created)
      terminals.set(terminalCode, {
        device: { deviceId: demoDevice.id, terminalId, branchId: branch.id },
        cashier,
        binding,
      })
    }
  }

  // 4. Credit profiles and loyalty accounts the plan's tenders need.
  const exposure = creditExposureByCustomerBranch(plan)
  const limits = demoCreditLimits(exposure, [...exposure.keys()])
  for (const [key, limitMinor] of limits) {
    const separator = key.indexOf(':')
    const branchCode = key.slice(0, separator)
    const customerId = key.slice(separator + 1)
    const branch = branches.find((entry) => entry.fixture.code === branchCode)
    if (!branch || !customerId) continue

    const profile = (
      await db
        .select({ id: creditProfile.id, limitMinor: creditProfile.limitMinor })
        .from(creditProfile)
        .where(and(eq(creditProfile.customerId, customerId), eq(creditProfile.branchId, branch.id)))
        .limit(1)
    )[0]

    if (!profile) {
      await db
        .insert(creditProfile)
        .values({ customerId, branchId: branch.id, limitMinor, createdBy: 'seed' })
        .onConflictDoNothing()
      result.created.push(`credit profile ${branchCode}`)
      continue
    }
    if (profile.limitMinor < limitMinor) {
      // Raise only: an existing balance is never touched and a limit the operator
      // lowered by hand is never widened.
      await db.update(creditProfile).set({ limitMinor }).where(eq(creditProfile.id, profile.id))
      result.created.push(`credit limit ${branchCode}`)
    }
  }

  for (const customerId of customers.loyalty) {
    const inserted = await db
      .insert(loyaltyAccount)
      .values({ customerId })
      .onConflictDoNothing()
      .returning({ id: loyaltyAccount.id })
    if (inserted[0]) result.created.push('loyalty account')
  }

  // 5. Shifts and sales, in plan order (day → branch → terminal → sale).
  const attachedIds = [...new Set(plan.map((entry) => entry.customerId).filter(Boolean))]
  const customerRows = new Map<string, { phone: string | null; name: string }>()
  if (attachedIds.length > 0) {
    const rows = await db
      .select({ id: customer.id, phone: customer.phone, name: customer.name })
      .from(customer)
      .where(inArray(customer.id, attachedIds as string[]))
    for (const row of rows) customerRows.set(row.id, { phone: row.phone, name: row.name })
  }

  const groups = new Map<string, PlannedSale[]>()
  for (const planned of plan) {
    const key = `${planned.terminalCode}|${planned.day}`
    const list = groups.get(key)
    if (list) list.push(planned)
    else groups.set(key, [planned])
  }

  const taxCategoryByProduct = new Map(products.map((row) => [row.id, row.taxCategory]))
  const earnPreviewCache = new Map<number, number>()

  for (const [key, plannedSales] of groups) {
    const [terminalCode, day] = key.split('|')
    if (!terminalCode || !day) continue
    const context = terminals.get(terminalCode)
    if (!context) throw new Error(`no terminal context for ${terminalCode}`)

    const shiftNumber = `${terminalCode}-S-${day.replaceAll('-', '')}-01`
    const existingShift = (
      await db
        .select({ id: shift.id, status: shift.status })
        .from(shift)
        .where(eq(shift.number, shiftNumber))
        .limit(1)
    )[0]

    if (existingShift && existingShift.status !== 'OPEN') {
      throw new Error(
        `demo shift ${shiftNumber} already exists and is closed; remove the partial demo run before retrying`,
      )
    }

    const shiftId = existingShift?.id ?? crypto.randomUUID()
    if (!existingShift) {
      await openShift(context.device, {
        shiftId,
        number: shiftNumber,
        openingFloatMinor: OPENING_FLOAT_MINOR,
        cashierUserId: context.cashier.userId,
        cashierStaffId: context.cashier.staffId,
        occurredAt: `${day}T08:00:00.000Z`,
      })
      result.shifts += 1
    }

    let cashTendersMinor = 0
    let changeMinor = 0

    for (const planned of plannedSales) {
      const lines = planned.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        lineDiscountMinor: 0,
        taxCategory: taxCategoryByProduct.get(line.productId) ?? 'STANDARD',
      }))

      const redeemPoints = planned.loyaltyRedeemPoints
      const loyaltyDiscountMinor =
        redeemPoints > 0 ? pointsToValueMinor(redeemPoints, pointsPerCedi) : 0
      const priced = priceCart(lines, { taxMode, loyaltyDiscountMinor })

      const tenderedMinor =
        planned.tender === 'CASH'
          ? Math.max(planned.cashTenderedMinor, priced.totalMinor)
          : priced.totalMinor
      const saleChangeMinor = planned.tender === 'CASH' ? tenderedMinor - priced.totalMinor : 0

      let earnPreviewPoints = 0
      if (redeemPoints > 0) {
        const cached = earnPreviewCache.get(priced.baseMinor)
        if (cached === undefined) {
          earnPreviewPoints = await earnPointsForSale(priced.baseMinor)
          earnPreviewCache.set(priced.baseMinor, earnPreviewPoints)
        } else {
          earnPreviewPoints = cached
        }
      }

      const attached = planned.customerId ? customerRows.get(planned.customerId) : undefined
      if (planned.customerId && !attached?.phone) {
        throw new Error(`customer ${planned.customerId} has no phone for the sale payload`)
      }
      const saleCustomer =
        planned.customerId && attached?.phone
          ? { id: planned.customerId, phone: attached.phone, name: attached.name }
          : null

      const payload: SalePayload = {
        receiptNumber: planned.receiptNumber,
        shiftId,
        cashier: {
          userId: context.cashier.userId,
          staffId: context.cashier.staffId,
          bindingId: context.binding.bindingId,
          bindingToken: context.binding.bindingToken,
          pinVersion: context.cashier.pinVersion,
        },
        customer: saleCustomer,
        lines,
        saleDiscount: null,
        loyalty: redeemPoints > 0 ? { redeemPoints, earnPreviewPoints } : null,
        tenders: [{ method: planned.tender, amountMinor: tenderedMinor }],
        totals: totalsPayload(priced, saleChangeMinor),
        occurredAt: planned.occurredAt,
        appVersion: 'seed',
      }

      const saleContext: SaleContext = {
        clientTransactionId: planned.clientTransactionId,
        device: context.device,
        // Equal to the sale time: the seed is not a late upload, so no CLOCK_SKEW conflict.
        receivedAt: new Date(planned.occurredAt),
        clockSkewToleranceMinutes: 999_999,
      }

      try {
        await db.transaction((tx) => applySale(saleContext, payload, tx))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // Never skip a sale silently: a short month would make reconciliation lie.
        throw new Error(`demo sale ${planned.receiptNumber} failed: ${message}`)
      }

      result.sales += 1
      if (planned.tender === 'CASH') {
        cashTendersMinor += tenderedMinor
        changeMinor += saleChangeMinor
      }
    }

    const expected = computeExpectedCash({
      openingFloatMinor: OPENING_FLOAT_MINOR,
      cashTendersMinor,
      changeMinor,
      cashInMinor: 0,
      cashOutMinor: 0,
      // The demo shifts record no refunds, so no cash ever left this drawer.
      cashRefundsMinor: 0,
    })
    await closeShift(context.device, {
      shiftId,
      countedCashMinor: expected,
      clientExpectedCashMinor: expected,
      occurredAt: `${day}T19:00:00.000Z`,
    })
  }

  return result
}
