import { createHash } from 'node:crypto'
import type { TaxCategory } from '@sceptre/shared'

/**
 * Deterministic planner for the demo month.
 *
 * Pure on purpose (`no DB, no clock, no Math.random`): the same options always produce the
 * same sales, so a rerun collides on the receipt number instead of inventing a second
 * month, and the seed's tests can assert the shape without a database.
 *
 * Nothing here values money with a float: prices are integer pesewas, credit limits are
 * derived with integer basis points, and the only ratios used are planner *targets*.
 */

const DAY_MS = 86_400_000

/** Two retail branches; `ACC-SPX` already exists in `demo.ts` and is reused when present. */
export const DEMO_SALES_BRANCHES: readonly DemoPlanBranch[] = [
  {
    code: 'ACC-SPX',
    name: 'Accra Spintex',
    city: 'Accra',
    // T01 belongs to `seed/demo.ts`, which already owns a closed shift on it; the demo month
    // uses its own T02 and T03 so a run can never collide with the shipped fixture.
    terminals: ['ACC-SPX-T02', 'ACC-SPX-T03'],
  },
  {
    code: 'KUM-ASO',
    name: 'Kumasi Asokwa',
    city: 'Kumasi',
    terminals: ['KUM-ASO-T01', 'KUM-ASO-T02'],
  },
] as const

export interface DemoPlanBranch {
  code: string
  name: string
  city: string
  terminals: string[]
}

export interface DemoPlanProduct {
  id: string
  priceMinor: number
  costMinor: number
  taxCategory: TaxCategory
}

export interface DemoPlanCustomer {
  id: string
  kind: 'CASH' | 'CREDIT'
  /** A cash customer with a loyalty account. Credit customers never redeem here. */
  loyalty: boolean
}

export interface DemoPlanOptions {
  /** Accra calendar day the plan ends on, `YYYY-MM-DD`. */
  endDay: string
  days: number
  seed: number
  branches: readonly DemoPlanBranch[]
  products: readonly DemoPlanProduct[]
  customers: readonly DemoPlanCustomer[]
}

export interface PlannedSaleLine {
  productId: string
  quantity: number
  unitPriceMinor: number
}

export interface PlannedSale {
  branchCode: string
  terminalCode: string
  day: string
  occurredAt: string
  lines: PlannedSaleLine[]
  tender: 'CASH' | 'CREDIT'
  customerId: string | null
  loyaltyRedeemPoints: number
  cashTenderedMinor: number
  receiptNumber: string
  /**
   * Deterministic UUID derived from `(branch, terminal, day, index)`. The writer sends it
   * as the client transaction id, so a rerun that got past the guard still collides on the
   * sale's unique key rather than double-selling. Not in the plan's sketch, but the writer
   * needs it and deriving it twice would be worse.
   */
  clientTransactionId: string
}

/** Redemption unit: the demo programme's 100 points = GHS 1.00 at the default rate. */
export const DEMO_REDEEM_POINTS = 100

/** Minimum credit limit, so a tiny month still looks like a trade account (GHS 5,000). */
export const DEMO_MIN_CREDIT_LIMIT_MINOR = 500_000

/**
 * Credit limit targets in basis points of planned exposure: the first customer ends around
 * 45% utilisation, the second around 71%, the third just over 100% so the ">100%" bucket
 * and the over-limit review path are both populated. Integer maths only.
 */
export const DEMO_CREDIT_LIMIT_TARGET_BP = [22_000, 14_000, 9_500] as const

/** Small, fast, deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** One independent stream per `(seed, terminal, day)` so days cannot influence each other. */
function streamFor(seed: number, terminalCode: string, day: string): () => number {
  return mulberry32(fnv1a(`${seed}:${terminalCode}:${day}`))
}

function parseDay(day: string): Date {
  const date = new Date(`${day}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) {
    throw new Error(`endDay must be an ISO date, got ${day}`)
  }
  return date
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Sales per terminal per day: a quiet Sunday, a busy Friday and Saturday. */
function salesForDay(weekday: number, rng: () => number): number {
  if (weekday === 0) return 4 + Math.floor(rng() * 6)
  if (weekday === 5 || weekday === 6) return 14 + Math.floor(rng() * 13)
  return 9 + Math.floor(rng() * 10)
}

/** Opening hours with a lunchtime and an evening bump; Sunday closes at 15:00. */
function hourWeights(weekday: number): Array<{ hour: number; weight: number }> {
  if (weekday === 0) {
    return [
      { hour: 9, weight: 1 },
      { hour: 10, weight: 2 },
      { hour: 11, weight: 4 },
      { hour: 12, weight: 5 },
      { hour: 13, weight: 4 },
      { hour: 14, weight: 3 },
    ]
  }
  return [
    { hour: 9, weight: 1 },
    { hour: 10, weight: 2 },
    { hour: 11, weight: 4 },
    { hour: 12, weight: 5 },
    { hour: 13, weight: 4 },
    { hour: 14, weight: 3 },
    { hour: 15, weight: 2 },
    { hour: 16, weight: 4 },
    { hour: 17, weight: 5 },
    { hour: 18, weight: 2 },
  ]
}

function pickHour(weekday: number, rng: () => number): number {
  const weights = hourWeights(weekday)
  const total = weights.reduce((sum, entry) => sum + entry.weight, 0)
  let target = rng() * total
  for (const entry of weights) {
    target -= entry.weight
    if (target <= 0) return entry.hour
  }
  return weights[weights.length - 1]?.hour ?? 12
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0')
}

/** The smallest note that covers `amountMinor`; larger baskets round to GHS 1,000 steps. */
const NOTES_MINOR = [1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000] as const

export function roundUpToNote(amountMinor: number): number {
  for (const note of NOTES_MINOR) {
    if (note >= amountMinor) return note
  }
  return Math.ceil(amountMinor / 100_000) * 100_000
}

/** A stable UUID-shaped id from the key parts (version 5 nibble, RFC 4122 variant). */
export function demoClientTransactionId(
  branchCode: string,
  terminalCode: string,
  day: string,
  index: number,
): string {
  const hex = createHash('sha256')
    .update(`sceptre-demo-sales:${branchCode}:${terminalCode}:${day}:${index}`)
    .digest('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}

function pickProductIndex(size: number, rng: () => number): number {
  // `rng() ** 2.2` skews towards the head of the list, so a few products are clear top
  // sellers and the product report has a shape worth looking at.
  const index = Math.floor(size * rng() ** 2.2)
  return Math.min(Math.max(index, 0), size - 1)
}

/**
 * Builds the sale plan.
 *
 * Ordering is `day → branch → terminal → sale`, which fixes the receipt and transaction
 * numbering; per-(terminal, day) random streams keep that ordering from changing the
 * individual sales.
 */
export function planDemoSales(options: DemoPlanOptions): PlannedSale[] {
  if (options.days < 1) throw new Error('days must be at least 1')
  if (options.products.length === 0) throw new Error('the plan needs at least one product')

  const end = parseDay(options.endDay)
  const creditCustomers = options.customers.filter((customer) => customer.kind === 'CREDIT')
  const loyaltyCustomers = options.customers.filter(
    (customer) => customer.kind === 'CASH' && customer.loyalty,
  )

  const sales: PlannedSale[] = []
  let creditCursor = 0
  let loyaltyCursor = 0
  const loyaltySaleCounts = new Map<string, number>()

  for (let offset = options.days - 1; offset >= 0; offset -= 1) {
    const date = new Date(end.getTime() - offset * DAY_MS)
    const day = isoDay(date)
    const weekday = date.getUTCDay()
    const receiptCounters = new Map<string, number>()

    for (const branch of options.branches) {
      for (const terminalCode of branch.terminals) {
        const rng = streamFor(options.seed, terminalCode, day)
        const count = salesForDay(weekday, rng)
        let branchCounter = receiptCounters.get(branch.code) ?? 0

        for (let index = 0; index < count; index += 1) {
          const hour = pickHour(weekday, rng)
          const minute = Math.floor(rng() * 60)
          const second = Math.floor(rng() * 60)
          const occurredAt = `${day}T${pad(hour)}:${pad(minute)}:${pad(second)}.000Z`

          const lineCount = 1 + Math.floor(rng() * 4)
          const used = new Set<number>()
          const lines: PlannedSaleLine[] = []
          for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
            let productIndex = pickProductIndex(options.products.length, rng)
            let attempts = 0
            while (used.has(productIndex) && attempts < 5) {
              productIndex = pickProductIndex(options.products.length, rng)
              attempts += 1
            }
            if (used.has(productIndex)) {
              for (let candidate = 0; candidate < options.products.length; candidate += 1) {
                if (!used.has(candidate)) {
                  productIndex = candidate
                  break
                }
              }
            }
            used.add(productIndex)
            const product = options.products[productIndex]
            if (!product) continue
            lines.push({
              productId: product.id,
              quantity: 1 + Math.floor(rng() * 3),
              unitPriceMinor: product.priceMinor,
            })
          }

          const grossMinor = lines.reduce(
            (total, line) => total + line.unitPriceMinor * line.quantity,
            0,
          )

          let tender: 'CASH' | 'CREDIT' = 'CASH'
          let customerId: string | null = null
          let loyaltyRedeemPoints = 0

          if (creditCustomers.length > 0 && rng() < 0.12) {
            tender = 'CREDIT'
            const customer = creditCustomers[creditCursor % creditCustomers.length]
            creditCursor += 1
            customerId = customer?.id ?? null
          } else if (loyaltyCustomers.length > 0 && rng() < 0.2) {
            const customer = loyaltyCustomers[loyaltyCursor % loyaltyCustomers.length]
            loyaltyCursor += 1
            customerId = customer?.id ?? null
            if (customerId) {
              const seen = (loyaltySaleCounts.get(customerId) ?? 0) + 1
              loyaltySaleCounts.set(customerId, seen)
              // Every fifth loyalty sale redeems; earlier ones have earned the balance.
              if (seen % 5 === 0) loyaltyRedeemPoints = DEMO_REDEEM_POINTS
            }
          }

          branchCounter += 1
          sales.push({
            branchCode: branch.code,
            terminalCode,
            day,
            occurredAt,
            lines,
            tender,
            customerId,
            loyaltyRedeemPoints,
            cashTenderedMinor: tender === 'CASH' ? roundUpToNote(grossMinor) : grossMinor,
            receiptNumber: `DEMO-${branch.code}-${day.replaceAll('-', '')}-${pad(branchCounter)}`,
            clientTransactionId: demoClientTransactionId(branch.code, terminalCode, day, index),
          })
        }

        receiptCounters.set(branch.code, branchCounter)
      }
    }
  }

  return sales
}

/** `branchCode:customerId` — a credit profile is per customer *per branch*. */
export function creditExposureKey(branchCode: string, customerId: string): string {
  return `${branchCode}:${customerId}`
}

/**
 * Planned credit exposure per (branch, customer), in minor units. The writer turns this
 * into a profile limit with `demoCreditLimits`.
 */
export function creditExposureByCustomerBranch(sales: readonly PlannedSale[]): Map<string, number> {
  const exposure = new Map<string, number>()
  for (const sale of sales) {
    if (sale.tender !== 'CREDIT' || !sale.customerId) continue
    const total = sale.lines.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0)
    const key = creditExposureKey(sale.branchCode, sale.customerId)
    exposure.set(key, (exposure.get(key) ?? 0) + total)
  }
  return exposure
}

/**
 * A limit for each credit customer, in integer minor units.
 *
 * `DEMO_CREDIT_LIMIT_TARGET_BP[i]` is the exposure the limit is meant to represent, so a
 * target of 22,000 bp (220%) leaves the customer at ~45% utilisation. The floor keeps a
 * short plan from looking like a corner shop's credit line.
 */
export function demoCreditLimits(
  exposure: Map<string, number>,
  customerIds: readonly string[],
): Map<string, number> {
  const limits = new Map<string, number>()
  customerIds.forEach((customerId, index) => {
    const target = DEMO_CREDIT_LIMIT_TARGET_BP[index % DEMO_CREDIT_LIMIT_TARGET_BP.length] ?? 10_000
    const exposureMinor = exposure.get(customerId) ?? 0
    const planned = Math.ceil((exposureMinor * 10_000) / target)
    limits.set(customerId, Math.max(DEMO_MIN_CREDIT_LIMIT_MINOR, planned))
  })
  return limits
}

/** Units the plan will take out of stock per branch and product (oversell buffer aside). */
export function plannedUnitsByBranchProduct(sales: readonly PlannedSale[]): Map<string, number> {
  const units = new Map<string, number>()
  for (const sale of sales) {
    for (const line of sale.lines) {
      const key = `${sale.branchCode}:${line.productId}`
      units.set(key, (units.get(key) ?? 0) + line.quantity)
    }
  }
  return units
}

// --- Count history -----------------------------------------------------------

/**
 * Days before `endDay` each posted demo count lands. Spread across a quarter so
 * the accuracy window and the ROTATION ordering both have real history.
 */
export const DEMO_COUNT_DAYS_AGO = [78, 46, 13] as const

/** Lines per count: a rotation slice of the twelve-part demo catalogue. */
export const DEMO_COUNT_LINES = 6

/**
 * How far each count's slice advances through the catalogue. With twelve parts
 * and six lines, four keeps every part's last-counted day distinct, so
 * `selectRotationProductIds` has a genuine order instead of one flat date
 * (P12-D28).
 */
const DEMO_COUNT_SLICE_STRIDE = 4

export interface PlannedCountLine {
  productId: string
  /** `counted_qty - snapshot_qty`; `0` is a matched line. */
  delta: number
}

export interface PlannedDemoCount {
  number: string
  dueAt: string
  postedAt: string
  lines: PlannedCountLine[]
}

/**
 * A deterministic history of posted stock counts for one branch (Phase 12).
 *
 * Pure like the sale plan: the same `(branch, endDay, products, seed)` always
 * produces the same numbers, dates, and counted quantities, so the seed is
 * idempotent by document number and a demo screenshot is reproducible.
 *
 * Two lines in every three match their snapshot exactly and the rest carry a
 * small ±1–3 unit variance, so `countAccuracyBp` is a real figure strictly
 * between 0 and 10,000 without ever being a fabricated "perfect" count.
 */
export function planDemoCounts(options: {
  branchCode: string
  endDay: string
  productIds: readonly string[]
  seed: number
}): PlannedDemoCount[] {
  if (options.productIds.length === 0) return []

  const end = parseDay(options.endDay)
  const lineCount = Math.min(DEMO_COUNT_LINES, options.productIds.length)

  return DEMO_COUNT_DAYS_AGO.map((daysAgo, countIndex) => {
    const day = isoDay(new Date(end.getTime() - daysAgo * DAY_MS))
    const rng = mulberry32(fnv1a(`${options.seed}:${options.branchCode}:count:${countIndex}`))
    const used = new Set<string>()
    const lines: PlannedCountLine[] = []

    for (let lineIndex = 0; lineIndex < lineCount; lineIndex += 1) {
      const productIndex =
        (countIndex * DEMO_COUNT_SLICE_STRIDE + lineIndex) % options.productIds.length
      const productId = options.productIds[productIndex]
      // A short catalogue can wrap the slice; one line per product, like the
      // `(count_id, product_id)` unique index demands.
      if (!productId || used.has(productId)) continue
      used.add(productId)

      const magnitude = 1 + Math.floor(rng() * 3)
      const matched = (countIndex + lineIndex) % 3 !== 0
      lines.push({
        productId,
        delta: matched ? 0 : rng() < 0.5 ? -magnitude : magnitude,
      })
    }

    return {
      number: `DEMO-CNT-${options.branchCode}-${String(countIndex + 1).padStart(2, '0')}`,
      dueAt: day,
      postedAt: `${day}T16:30:00.000Z`,
      lines,
    }
  })
}
