import { db } from '@gikautos/db'
import {
  createUserWithCredential,
  ensureBranch,
  ensureBrand,
  ensureCategory,
  ensureProduct,
  ensureProductPrice,
  ensureSequenceAtLeast,
  ensureSetting,
  ensureStockReceipt,
  ensureStockThreshold,
  ensureTerminal,
  ensureUom,
  findUserByEmail,
} from './helpers.ts'

export interface SeedDemoResult {
  created: string[]
}

const DEMO_MANAGER_EMAIL = 'manager@gikautos.local'
const DEMO_CASHIER_EMAIL = 'cashier@gikautos.local'
const DEMO_PASSWORD_DEFAULT = 'demo-password-1234'

export const DEMO_UNITS = [
  { code: 'PCS', name: 'Piece' },
  { code: 'SET', name: 'Set' },
  { code: 'PAIR', name: 'Pair' },
  { code: 'BOX', name: 'Box' },
  { code: 'LTR', name: 'Litre' },
] as const

export const DEMO_BRANDS = ['Bosch', 'Denso', 'NGK', 'Febi'] as const

export const DEMO_CATEGORIES = [
  { name: 'Engine', children: ['Oil Filters', 'Air Filters', 'Belts'] },
  { name: 'Brakes', children: ['Pads', 'Discs'] },
  { name: 'Electrical', children: ['Batteries', 'Spark Plugs'] },
  { name: 'Fluids', children: ['Engine Oil'] },
] as const

interface DemoProduct {
  sku: string
  name: string
  description: string
  category: string
  brand: string
  uom: string
  costPriceMinor: number
  basePriceMinor: number
  barcodes: string[]
}

export const DEMO_PRODUCTS: readonly DemoProduct[] = [
  {
    sku: 'GIK-00001',
    name: 'Bosch Oil Filter',
    description: 'Spin-on oil filter for common saloon engines',
    category: 'Oil Filters',
    brand: 'Bosch',
    uom: 'PCS',
    costPriceMinor: 4_500,
    basePriceMinor: 7_500,
    barcodes: ['5901234123457', '4006381333931'],
  },
  {
    sku: 'GIK-00002',
    name: 'Denso Oil Filter',
    description: 'OEM-spec oil filter for Toyota and Lexus',
    category: 'Oil Filters',
    brand: 'Denso',
    uom: 'PCS',
    costPriceMinor: 5_000,
    basePriceMinor: 8_000,
    barcodes: ['5901234123464'],
  },
  {
    sku: 'GIK-00003',
    name: 'Denso Air Filter Corolla',
    description: 'Panel air filter for Toyota Corolla 2009-2019',
    category: 'Air Filters',
    brand: 'Denso',
    uom: 'PCS',
    costPriceMinor: 6_000,
    basePriceMinor: 9_500,
    barcodes: ['DEN-17801-0T020'],
  },
  {
    sku: 'GIK-00004',
    name: 'Bosch Air Filter Hilux',
    description: 'Panel air filter for Toyota Hilux 2016+',
    category: 'Air Filters',
    brand: 'Bosch',
    uom: 'PCS',
    costPriceMinor: 7_500,
    basePriceMinor: 12_000,
    barcodes: ['BSH-AF-HLX-001'],
  },
  {
    sku: 'GIK-00005',
    name: 'Febi Timing Belt Kit',
    description: 'Timing belt kit with tensioner for 1.6-2.0 engines',
    category: 'Belts',
    brand: 'Febi',
    uom: 'SET',
    costPriceMinor: 18_000,
    basePriceMinor: 28_000,
    barcodes: ['FEB-TBK-1999'],
  },
  {
    sku: 'GIK-00006',
    name: 'Bosch Front Brake Pads',
    description: 'Front axle brake pad set for common saloons',
    category: 'Pads',
    brand: 'Bosch',
    uom: 'SET',
    costPriceMinor: 12_000,
    basePriceMinor: 19_000,
    barcodes: ['BSH-BP-FR-7788'],
  },
  {
    sku: 'GIK-00007',
    name: 'Febi Rear Brake Pads',
    description: 'Rear axle brake pad set',
    category: 'Pads',
    brand: 'Febi',
    uom: 'SET',
    costPriceMinor: 10_500,
    basePriceMinor: 16_500,
    barcodes: ['FEB-BP-RR-9922'],
  },
  {
    sku: 'GIK-00008',
    name: 'Febi Brake Disc 280mm',
    description: 'Vented front brake disc, 280mm diameter',
    category: 'Discs',
    brand: 'Febi',
    uom: 'PAIR',
    costPriceMinor: 22_000,
    basePriceMinor: 34_000,
    barcodes: ['4008321967859'],
  },
  {
    sku: 'GIK-00009',
    name: 'Bosch S4 Battery 70Ah',
    description: 'Maintenance-free lead-acid battery, 70Ah',
    category: 'Batteries',
    brand: 'Bosch',
    uom: 'PCS',
    costPriceMinor: 55_000,
    basePriceMinor: 78_000,
    barcodes: ['BSH-S4-70A', '5901234123471'],
  },
  {
    sku: 'GIK-00010',
    name: 'Denso Battery 60Ah',
    description: 'Maintenance-free lead-acid battery, 60Ah',
    category: 'Batteries',
    brand: 'Denso',
    uom: 'PCS',
    costPriceMinor: 48_000,
    basePriceMinor: 69_000,
    barcodes: ['DEN-BT-60A'],
  },
  {
    sku: 'GIK-00011',
    name: 'NGK Iridium Spark Plug',
    description: 'Iridium spark plug, set of four',
    category: 'Spark Plugs',
    brand: 'NGK',
    uom: 'SET',
    costPriceMinor: 9_000,
    basePriceMinor: 14_000,
    barcodes: ['NGK-IR-IFR6'],
  },
  {
    sku: 'GIK-00012',
    name: 'Febi Engine Oil 5W-30 1L',
    description: 'Fully synthetic engine oil, one litre',
    category: 'Engine Oil',
    brand: 'Febi',
    uom: 'LTR',
    costPriceMinor: 6_500,
    basePriceMinor: 10_500,
    barcodes: ['FEB-EO-5W30-1L'],
  },
] as const

/**
 * Development-only demo data: a retail branch, a warehouse, one terminal per
 * branch, a manager, a cashier, and a small two-level catalog with products,
 * barcodes, and one branch price override. Idempotent.
 */
export async function seedDemo(): Promise<SeedDemoResult> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The demo seed refuses to run with NODE_ENV=production')
  }

  const created: string[] = []

  const retail = await ensureBranch({
    code: 'ACC-SPX',
    name: 'Accra Spintex',
    type: 'RETAIL',
    city: 'Accra',
    area: 'Spintex',
  })
  if (retail.created) created.push('branch ACC-SPX')

  const warehouse = await ensureBranch({
    code: 'ACC-WH1',
    name: 'Accra Warehouse',
    type: 'WAREHOUSE',
    city: 'Accra',
  })
  if (warehouse.created) created.push('branch ACC-WH1')

  if (await ensureTerminal({ branchId: retail.id, code: 'ACC-SPX-T01', name: 'Counter 1' })) {
    created.push('terminal ACC-SPX-T01')
  }
  // Warehouses are stock-only (INV-09): no POS terminal is seeded on ACC-WH1.

  const managerEmail = (process.env.DEMO_MANAGER_EMAIL ?? DEMO_MANAGER_EMAIL).trim().toLowerCase()
  const password = process.env.DEMO_PASSWORD ?? DEMO_PASSWORD_DEFAULT

  if (!(await findUserByEmail(managerEmail))) {
    await db.transaction(async (tx) => {
      await createUserWithCredential(tx, {
        email: managerEmail,
        name: 'Demo Manager',
        password,
        role: 'MANAGER',
        branchId: retail.id,
        mustChangePassword: true,
      })
    })
    created.push(`manager ${managerEmail}`)
  }

  if (!(await findUserByEmail(DEMO_CASHIER_EMAIL))) {
    await db.transaction(async (tx) => {
      await createUserWithCredential(tx, {
        email: DEMO_CASHIER_EMAIL,
        name: 'Demo Cashier',
        password,
        role: 'CASHIER',
        branchId: retail.id,
        mustChangePassword: true,
      })
    })
    created.push(`cashier ${DEMO_CASHIER_EMAIL}`)
  }

  const settingsSeeded = await Promise.all([
    ensureSetting('staff.idPrefix', process.env.STAFF_ID_PREFIX?.trim() || 'GA'),
    ensureSetting('receipt.header', 'Thank you for shopping at GikAutos'),
    ensureSetting('loyalty.earnPointsPerCedi', 1),
    ensureSetting('loyalty.pointsPerCedi', 100),
    ensureSetting('loyalty.expiryMonths', 12),
    ensureSetting('catalog.skuPrefix', 'GIK'),
    ensureSetting('catalog.skuSequence', 1),
    ensureSetting('pricing.taxMode', 'INCLUSIVE'),
    ensureSetting('inventory.receiptPrefix', 'GRN'),
    ensureSetting('inventory.transferPrefix', 'TRF'),
    ensureSetting('inventory.countPrefix', 'CNT'),
  ])
  if (settingsSeeded.some(Boolean)) created.push('settings defaults')

  const uomIds = new Map<string, string>()
  for (const unit of DEMO_UNITS) {
    const result = await ensureUom(unit)
    uomIds.set(unit.code, result.id)
    if (result.created) created.push(`unit ${unit.code}`)
  }

  const brandIds = new Map<string, string>()
  for (const name of DEMO_BRANDS) {
    const result = await ensureBrand({ name })
    brandIds.set(name, result.id)
    if (result.created) created.push(`brand ${name}`)
  }

  const categoryIds = new Map<string, string>()
  for (const parent of DEMO_CATEGORIES) {
    const parentRow = await ensureCategory({ name: parent.name })
    categoryIds.set(parent.name, parentRow.id)
    if (parentRow.created) created.push(`category ${parent.name}`)
    for (const child of parent.children) {
      const childRow = await ensureCategory({ name: child, parentId: parentRow.id })
      categoryIds.set(child, childRow.id)
      if (childRow.created) created.push(`category ${parent.name} > ${child}`)
    }
  }

  const productIds = new Map<string, string>()
  for (const item of DEMO_PRODUCTS) {
    const categoryId = categoryIds.get(item.category)
    const brandId = brandIds.get(item.brand)
    const uomId = uomIds.get(item.uom)
    if (!categoryId || !brandId || !uomId) {
      throw new Error(`Demo product ${item.sku} references an unknown master`)
    }

    const result = await ensureProduct({
      sku: item.sku,
      name: item.name,
      description: item.description,
      categoryId,
      brandId,
      uomId,
      costPriceMinor: item.costPriceMinor,
      basePriceMinor: item.basePriceMinor,
      barcodes: item.barcodes,
    })
    productIds.set(item.sku, result.id)
    if (result.created) created.push(`product ${item.sku}`)
  }

  const overrideProductId = productIds.get('GIK-00006')
  if (
    overrideProductId &&
    (await ensureProductPrice({
      productId: overrideProductId,
      branchId: retail.id,
      priceMinor: 18_500,
    }))
  ) {
    created.push('branch price override GIK-00006 @ ACC-SPX')
  }

  const productIdFor = (sku: string): string => {
    const id = productIds.get(sku)
    if (!id) throw new Error(`Demo product ${sku} was not created`)
    return id
  }

  const retailQuantityOverrides = new Map([
    ['GIK-00007', 3],
    ['GIK-00011', 8],
  ])

  if (
    await ensureStockReceipt({
      number: 'GRN-00001',
      branchId: warehouse.id,
      supplierName: 'GikAutos Imports',
      supplierInvoiceNumber: 'INV-2026-001',
      note: 'Opening stock — warehouse',
      createdAt: new Date('2026-10-01T08:00:00.000Z'),
      lines: DEMO_PRODUCTS.map((item, index) => ({
        productId: productIdFor(item.sku),
        quantity: 40 + (index % 5) * 10,
        unitCostMinor: item.costPriceMinor,
      })),
    })
  ) {
    created.push('opening stock GRN-00001 @ ACC-WH1')
  }

  if (
    await ensureStockReceipt({
      number: 'GRN-00002',
      branchId: retail.id,
      supplierName: 'Accra Parts Depot',
      supplierInvoiceNumber: 'APD-0451',
      note: 'Opening stock — retail floor',
      createdAt: new Date('2026-10-02T08:00:00.000Z'),
      lines: DEMO_PRODUCTS.map((item, index) => ({
        productId: productIdFor(item.sku),
        quantity: retailQuantityOverrides.get(item.sku) ?? 6 + (index % 4) * 3,
        unitCostMinor: item.costPriceMinor,
      })),
    })
  ) {
    created.push('opening stock GRN-00002 @ ACC-SPX')
  }

  for (const [sku, threshold] of [
    ['GIK-00007', 5],
    ['GIK-00011', 10],
  ] as const) {
    if (
      await ensureStockThreshold({
        productId: productIdFor(sku),
        branchId: retail.id,
        threshold,
      })
    ) {
      created.push(`stock threshold ${sku} @ ACC-SPX`)
    }
  }

  if (await ensureSequenceAtLeast('inventory.receiptSequence', 3)) {
    created.push('inventory receipt sequence')
  }

  if (await ensureSequenceAtLeast('catalog.skuSequence', DEMO_PRODUCTS.length + 1)) {
    created.push('catalog sequence')
  }

  return { created }
}
