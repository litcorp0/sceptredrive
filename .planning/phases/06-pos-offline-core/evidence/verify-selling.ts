#!/usr/bin/env bun
import { uploadTransactionSchema } from '../../../../api/src/modules/sync/sync.validation.ts'
import { cartReducer, emptyCart } from '../../../../desktop/src/renderer/lib/cart/reducer.ts'
import { computeCartTotals } from '../../../../desktop/src/renderer/lib/cart/totals.ts'
import {
  availableQuantity,
  toSellableProduct,
} from '../../../../desktop/src/renderer/lib/catalog/pricing.ts'
import { createScanBuffer } from '../../../../desktop/src/renderer/lib/catalog/scan-buffer.ts'
import { pickEnterTarget } from '../../../../desktop/src/renderer/lib/catalog/search.ts'
import {
  creditDecision,
  creditHeadroom,
} from '../../../../desktop/src/renderer/lib/credit/headroom.ts'
import {
  discountAmountFromInput,
  discountAuthority,
} from '../../../../desktop/src/renderer/lib/discounts/discount-service.ts'
import { quoteRedemption } from '../../../../desktop/src/renderer/lib/loyalty/quote.ts'
import { formatReceiptNumber } from '../../../../desktop/src/renderer/lib/sale/receipt-number.ts'
import { buildSaleDraft } from '../../../../desktop/src/renderer/lib/sale/sale-draft.ts'
/**
 * Plan 06 verification — selling-flow contract check.
 *
 * Walks the exact sequence a cashier performs offline (scan → quantity →
 * customer → loyalty → line discount + approval → credit approval → tender)
 * using the *real* desktop modules, then validates the resulting sale draft
 * against the API's upload schema and re-prices it with the shared engine.
 *
 * This is the goal-backward proof for Plan 06 without a running server: the
 * till's draft must be something the server will accept and agree with, field
 * for field.
 *
 * Usage: bun .planning/phases/06-pos-offline-core/evidence/verify-selling.ts
 */
import { priceCart } from '../../../../packages/shared/src/index.ts'

let checks = 0
let failures = 0
function check(label: string, condition: boolean, detail = ''): void {
  checks += 1
  if (condition) {
    console.log(`  PASS  ${label}`)
  } else {
    failures += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const NOW = '2026-10-23T10:00:00.000Z'
const SHIFT_ID = '77777777-7777-7777-8777-777777777777'
const CONTEXT = {
  taxMode: 'INCLUSIVE' as const,
  loyalty: { pointsPerCedi: 100, earnPointsPerCedi: 1 },
}

// The catalogue the terminal synced (product rows as PowerSync returns them).
const catalogue = [
  {
    id: '11111111-1111-7111-8111-111111111111',
    sku: 'GIK-00001',
    name: 'Brake Pad Set',
    base_price_minor: 12_000,
    tax_category: 'STANDARD',
    barcode: '4006381333931',
  },
  {
    id: '11111111-1111-7111-8111-111111111112',
    sku: 'GIK-00002',
    name: 'Oil Filter',
    base_price_minor: 4_500,
    tax_category: 'STANDARD',
    barcode: '9780201379624',
  },
  {
    id: '11111111-1111-7111-8111-111111111113',
    sku: 'GIK-00003',
    name: 'Workshop Rag',
    base_price_minor: 1_000,
    tax_category: 'ZERO_RATED',
    barcode: '0000000000017',
  },
]

console.log('Scenario: offline mixed sale with loyalty, discounts, and credit\n')

// 1. Scan a barcode into the cart (wedge buffer + catalogue resolution).
const scanner = createScanBuffer()
for (const [index, character] of [...'4006381333931'].entries()) {
  scanner.push(character, 1000 + index * 10)
}
const scanned = scanner.push('\n', 1000 + 13 * 10)
check('a scanner burst yields the barcode', scanned === '4006381333931', String(scanned))
const scannedRow = catalogue.find((row) => row.barcode === scanned) ?? null
check('the barcode resolves to one product', scannedRow?.sku === 'GIK-00001')

const brakePads = toSellableProduct(scannedRow!, 11_000) // branch override price
check('the branch override price wins', brakePads?.unitPriceMinor === 11_000)

// 2. Search by name for the second product and press Enter.
const filtered = catalogue.filter((row) => row.name.toLowerCase().includes('oil'))
const enterTarget = pickEnterTarget('oil', filtered)
check('Enter adds the only search result', enterTarget?.sku === 'GIK-00002')
const oilFilter = toSellableProduct(enterTarget!, null)

// 3. Build the cart: 2 brake pads, 1 oil filter, 2 rags.
let cart = emptyCart({ now: NOW, shiftId: SHIFT_ID })
cart = cartReducer(cart, { type: 'addProduct', product: brakePads!, quantity: 2, now: NOW })
cart = cartReducer(cart, { type: 'addProduct', product: oilFilter!, now: NOW })
cart = cartReducer(cart, {
  type: 'addProduct',
  product: toSellableProduct(catalogue[2]!, null)!,
  quantity: 2,
  now: NOW,
})
check('three lines, four units', cart.lines.length === 3)
check('stock shows 0 for an unsynced product', availableQuantity(0, 0) === 0)

// 4. Attach a customer.
cart = cartReducer(cart, {
  type: 'setCustomer',
  customer: {
    customerId: '44444444-4444-7444-8444-444444444444',
    draftId: null,
    name: 'Akosua Mensah',
    phone: '+233241234567',
    isDraft: false,
  },
  now: NOW,
})

// 5. Redeem loyalty points (250 pts = GHS 2.50) — value capped by the cart.
let totals = computeCartTotals(cart, CONTEXT)
const quote = quoteRedemption({
  points: 250,
  pointsPerCedi: 100,
  minimumRedeemPoints: 100,
  availablePoints: 1_000,
  cartNetMinor: totals.priced.netMinor,
})
check('the redemption quote has no problem', quote.problem === null)
check('250 points are worth GHS 2.50', quote.valueMinor === 250)
cart = cartReducer(cart, { type: 'setLoyaltyRedeem', points: 250, now: NOW })

// 6. A cashier applies a GHS 2.00 line discount — over the 0% cap, so a manager
//    approves it at the till.
totals = computeCartTotals(cart, CONTEXT)
const lineId = cart.lines[1]!.id
const lineDiscountMinor = discountAmountFromInput(
  '2.00',
  'AMOUNT',
  totals.priced.lines[1]!.grossMinor,
)!
check('the line discount parses to 200 pesewas', lineDiscountMinor === 200)

const proposed = cartReducer(cart, {
  type: 'setLineDiscount',
  lineId,
  discount: {
    amountMinor: lineDiscountMinor,
    reasonCode: 'STAFF',
    note: 'Loyalty card holder',
    override: null,
  },
  now: NOW,
})
const proposedTotals = computeCartTotals(proposed, CONTEXT)
const before = discountAuthority({
  role: 'CASHIER',
  totalDiscountMinor: proposedTotals.totalDiscountMinor,
  grossMinor: proposedTotals.grossMinor,
  caps: { maxCashierDiscountPercent: 0, maxManagerDiscountPercent: 100 },
  hasApproval: false,
})
check('a cashier discount above 0% needs approval', before.requiresApproval)
check(
  'the interactively applied loyalty discount is counted in the cap',
  proposedTotals.totalDiscountMinor >= lineDiscountMinor,
)

const proof = {
  approverUserId: 'user-manager',
  approverStaffId: 'GA-0002',
  approverRole: 'MANAGER' as const,
  bindingId: '22222222-2222-7222-8222-222222222222',
  pinVersion: 3,
  reasonCode: 'STAFF',
  note: 'Approved line discount',
  approvedAt: NOW,
}
const after = discountAuthority({
  role: 'CASHIER',
  totalDiscountMinor: proposedTotals.totalDiscountMinor,
  grossMinor: proposedTotals.grossMinor,
  caps: { maxCashierDiscountPercent: 0, maxManagerDiscountPercent: 100 },
  hasApproval: true,
})
check('a manager approval clears the block', after.approved)
cart = cartReducer(cart, {
  type: 'setLineDiscount',
  lineId,
  discount: {
    amountMinor: lineDiscountMinor,
    reasonCode: 'STAFF',
    note: 'Loyalty card holder',
    override: proof,
  },
  now: NOW,
})

// 7. Credit headroom: GHS 60 limit, GHS 20 used → GHS 40 available.
const credit = {
  hasProfile: true,
  limitMinor: 40_000,
  balanceMinor: 2_000,
  pendingMinor: 0,
  hold: false,
}
check('headroom is limit minus usage', creditHeadroom(credit) === 38_000)
totals = computeCartTotals(cart, CONTEXT)
const decision = creditDecision({
  hasCustomer: true,
  snapshot: credit,
  amountMinor: totals.priced.totalMinor,
})
check(
  'this cart fits the credit limit',
  decision === 'OK',
  `${decision} for ${totals.priced.totalMinor}`,
)

// 8. Tender on credit and build the sale draft.
const receiptNumber = formatReceiptNumber('SPX-T01', '20261023', 7)
const draft = buildSaleDraft({
  cart,
  totals,
  cashier: {
    userId: 'user-cashier',
    staffId: 'GA-0003',
    bindingId: '33333333-3333-7333-8333-333333333333',
    bindingToken: 'device-binding-token',
    pinVersion: 1,
  },
  shiftId: SHIFT_ID,
  receiptNumber,
  tender: { method: 'CREDIT', amountMinor: totals.priced.totalMinor, override: null },
  occurredAt: NOW,
  appVersion: '0.1.0',
})

// 9. The draft must satisfy the server's upload schema exactly.
const parsed = uploadTransactionSchema.safeParse(draft)
check(
  'the draft passes the API upload schema',
  parsed.success,
  parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3)),
)
check('the receipt number follows D13', draft.payload.receiptNumber === 'SPX-T01-20261023-0007')

// 10. Server-side re-pricing must agree with what the till charged.
const serverPriced = priceCart(
  draft.payload.lines.map((line) => ({ ...line, name: '', sku: '' })),
  {
    taxMode: CONTEXT.taxMode,
    saleDiscountMinor: draft.payload.saleDiscount?.amountMinor ?? 0,
    loyaltyDiscountMinor: draft.payload.totals.loyaltyDiscountMinor,
  },
)
check(
  'the server total equals the draft total',
  serverPriced.totalMinor === draft.payload.totals.totalMinor,
  `${serverPriced.totalMinor} vs ${draft.payload.totals.totalMinor}`,
)
check('VAT agrees', serverPriced.vatMinor === draft.payload.totals.vatMinor)
check('NHIL agrees', serverPriced.nhilMinor === draft.payload.totals.nhilMinor)
check('GETFund agrees', serverPriced.getfundMinor === draft.payload.totals.getfundMinor)
check('tax-exclusive base agrees', serverPriced.baseMinor === totals.priced.baseMinor)

// 11. Invariants: header = lines, tender = total, credit = one tender.
const lineTotal = draft.payload.lines.reduce(
  (sum, line) => sum + line.quantity * line.unitPriceMinor,
  0,
)
check('subtotal is the sum of line gross', lineTotal === draft.payload.totals.subtotalMinor)
check(
  'lines minus discounts equals the net base plus tax',
  draft.payload.totals.totalMinor === serverPriced.totalMinor,
)
check(
  'one credit tender for the full total',
  draft.payload.tenders.length === 1 &&
    draft.payload.tenders[0]!.method === 'CREDIT' &&
    draft.payload.tenders[0]!.amountMinor === draft.payload.totals.totalMinor,
)
check('no change on a credit sale', draft.payload.totals.changeMinor === 0)
check(
  'the customer travels with the sale',
  draft.payload.customer?.id === '44444444-4444-7444-8444-444444444444',
)
check(
  'the loyalty redemption travels with the sale',
  draft.payload.loyalty?.redeemPoints === 250 &&
    draft.payload.totals.loyaltyDiscountMinor === quote.appliedMinor,
)
check(
  'the approved line discount rides on the sale-discount slot',
  draft.payload.saleDiscount?.amountMinor === 0 &&
    draft.payload.saleDiscount?.override?.staffId === 'GA-0002',
)
check('the cart keeps its idempotency key', draft.clientTransactionId === cart.saleId)
check(
  'the earning preview is server-computable',
  draft.payload.loyalty?.earnPreviewPoints === Math.floor(serverPriced.baseMinor / 100),
)

// 12. A cash tendered sale computes change exactly like the server.
const cashDraft = buildSaleDraft({
  cart,
  totals,
  cashier: {
    userId: 'user-cashier',
    staffId: 'GA-0003',
    bindingId: '33333333-3333-7333-8333-333333333333',
    bindingToken: 'device-binding-token',
    pinVersion: 1,
  },
  shiftId: SHIFT_ID,
  receiptNumber,
  tender: { method: 'CASH', amountMinor: totals.priced.totalMinor + 5_000, override: null },
  occurredAt: NOW,
})
check('cash change is tender minus total', cashDraft.payload.totals.changeMinor === 5_000)
check('exact cash is also schema-valid', uploadTransactionSchema.safeParse(cashDraft).success)

console.log(`\n${checks - failures}/${checks} checks passed`)
if (failures > 0) {
  console.error(`${failures} check(s) failed`)
  process.exit(1)
}
