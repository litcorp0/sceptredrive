import { db } from '@sceptre/db'
import {
  closeDemoShift,
  computeAbcClasses,
  createUserWithCredential,
  ensureBranch,
  ensureBrand,
  ensureCategory,
  ensureCountSchedule,
  ensureCreditOpening,
  ensureCustomer,
  ensureDemoConflict,
  ensureDemoPin,
  ensureDemoSale,
  ensureDemoShift,
  ensureDevice,
  ensureLoyaltyEarn,
  ensureProduct,
  ensureProductPrice,
  ensureSequenceAtLeast,
  ensureSetting,
  ensureStockReceipt,
  ensureStockThreshold,
  ensureSupplier,
  ensureSupplierInvoice,
  ensureSupplierPayment,
  ensureSupplierPaymentDetail,
  ensureSupplierProduct,
  ensureTerminal,
  ensureUom,
  findStockReceiptId,
  findTerminalIdByCode,
  findUserByEmail,
  linkReceiptSuppliers,
} from './helpers.ts'

export interface SeedDemoResult {
  created: string[]
}

const DEMO_MANAGER_EMAIL = 'manager@sceptre.local'
const DEMO_CASHIER_EMAIL = 'cashier@sceptre.local'
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
 * branch, a manager, a cashier, a small two-level catalog with products,
 * barcodes, and branch prices, opening stock with thresholds, and demo
 * customers carrying a branch credit balance and loyalty points. Idempotent.
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
    ensureSetting('receipt.header', 'Thank you for shopping at Sceptre Drive'),
    ensureSetting('loyalty.earnPointsPerCedi', 1),
    ensureSetting('loyalty.pointsPerCedi', 100),
    ensureSetting('loyalty.expiryMonths', 12),
    ensureSetting('loyalty.minimumRedeemPoints', 100),
    ensureSetting('credit.repaymentPrefix', 'REP'),
    ensureSetting('credit.repaymentSequence', 1),
    ensureSetting('catalog.skuPrefix', 'GIK'),
    ensureSetting('catalog.skuSequence', 1),
    ensureSetting('pricing.taxMode', 'INCLUSIVE'),
    ensureSetting('inventory.receiptPrefix', 'GRN'),
    ensureSetting('inventory.transferPrefix', 'TRF'),
    ensureSetting('inventory.countPrefix', 'CNT'),
    ensureSetting('pos.maxCashierDiscountPercent', 0),
    ensureSetting('pos.maxManagerDiscountPercent', 100),
    ensureSetting('pos.pinMaxAttempts', 5),
    ensureSetting('pos.pinLockMinutes', 5),
    ensureSetting('pos.clockSkewToleranceMinutes', 10),
    ensureSetting('pos.syncBatchSize', 25),
    ensureSetting('pos.receiptFooter', 'Thank you for your business'),
    ensureSetting('pos.salesRequireOpenShift', true),
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
      supplierName: 'Sceptre Drive Imports',
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

  const accraParts = await ensureSupplier({
    code: 'SUP-00001',
    name: 'Accra Parts Depot',
    contactName: 'Nana Adjei',
    phone: '+233302555001',
    email: 'accounts@accraparts.example',
    address: 'Industrial Area, Accra',
    tin: 'C0012345678',
    vatNumber: 'V0012345678',
    paymentTermDays: 30,
  })
  if (accraParts.created) created.push('supplier SUP-00001 Accra Parts Depot')

  const sceptreImports = await ensureSupplier({
    code: 'SUP-00002',
    name: 'Sceptre Drive Imports',
    contactName: 'Esi Danso',
    phone: '+233302555002',
    email: 'finance@sceptredrive.example',
    address: 'Tema Harbour Area, Tema',
    tin: 'C0098765432',
    paymentTermDays: 14,
  })
  if (sceptreImports.created) created.push('supplier SUP-00002 Sceptre Drive Imports')

  if (
    await ensureSupplierPaymentDetail({
      supplierId: accraParts.id,
      method: 'BANK',
      accountName: 'Accra Parts Depot Ltd',
      accountNumber: '1234567890',
      bankName: 'GCB Bank',
      bankCode: 'GCB',
    })
  ) {
    created.push('supplier bank detail SUP-00001')
  }

  if (
    await ensureSupplierPaymentDetail({
      supplierId: accraParts.id,
      method: 'MOMO',
      accountName: 'Accra Parts Depot',
      accountNumber: '0244000001',
      momoNetwork: 'MTN',
      phone: '+233244000001',
      isDefault: true,
    })
  ) {
    created.push('supplier MoMo detail SUP-00001')
  }

  if (
    await ensureSupplierPaymentDetail({
      supplierId: sceptreImports.id,
      method: 'MOMO',
      accountName: 'Sceptre Drive Imports',
      accountNumber: '0244000002',
      momoNetwork: 'MTN',
      phone: '+233244000002',
      isDefault: true,
    })
  ) {
    created.push('supplier MoMo detail SUP-00002')
  }

  const linkedReceipts = await linkReceiptSuppliers({
    'Accra Parts Depot': accraParts.id,
    'Sceptre Drive Imports': sceptreImports.id,
  })
  if (linkedReceipts > 0) created.push(`linked ${linkedReceipts} receipt(s) to suppliers`)

  const supplierProductMappings = [
    ['SUP-00001', 'GIK-00001', 'APD-OF-4501', 7, 4_500, true],
    ['SUP-00001', 'GIK-00006', 'APD-BP-1275', 10, 12_000, false],
    ['SUP-00002', 'GIK-00002', 'GIKIMP-OF-0500', 21, 5_000, false],
    ['SUP-00002', 'GIK-00007', 'GIKIMP-BP-9910', 21, 10_500, false],
  ] as const

  for (const [
    supplierCode,
    sku,
    supplierSku,
    leadTimeDays,
    lastCostMinor,
    isPreferred,
  ] of supplierProductMappings) {
    const supplierId = supplierCode === 'SUP-00001' ? accraParts.id : sceptreImports.id
    if (
      await ensureSupplierProduct({
        supplierId,
        productId: productIdFor(sku),
        supplierSku,
        leadTimeDays,
        lastCostMinor,
        isPreferred,
      })
    ) {
      created.push(`supplier product ${supplierCode} × ${sku}`)
    }
  }

  const grnTwoId = await findStockReceiptId('GRN-00002')
  if (!grnTwoId) throw new Error('Demo receipt GRN-00002 is missing')

  const receiptInvoice = await ensureSupplierInvoice({
    number: 'SINV-00001',
    supplierId: accraParts.id,
    branchId: retail.id,
    supplierInvoiceNumber: 'APD-0451',
    invoiceDate: '2026-10-02',
    dueDate: '2026-11-01',
    receiptId: grnTwoId,
    note: 'Opened from GRN-00002',
    tax: 'DERIVED',
    lines: DEMO_PRODUCTS.map((item, index) => ({
      productId: productIdFor(item.sku),
      quantity: retailQuantityOverrides.get(item.sku) ?? 6 + (index % 4) * 3,
      unitCostMinor: item.costPriceMinor,
    })),
  })
  if (receiptInvoice.created) created.push('supplier invoice SINV-00001 @ ACC-SPX')

  const partPaymentMinor = Math.floor((receiptInvoice.totalMinor * 40) / 100)
  if (
    await ensureSupplierPayment({
      number: 'PAY-00001',
      supplierId: accraParts.id,
      branchId: retail.id,
      method: 'MOMO',
      amountMinor: partPaymentMinor,
      paidAt: new Date('2026-10-09T10:30:00.000Z'),
      reference: 'MOMO-APD-1009',
      allocations: [{ invoiceId: receiptInvoice.id, amountMinor: partPaymentMinor }],
    })
  ) {
    created.push('supplier payment PAY-00001 @ ACC-SPX')
  }

  const standaloneInvoice = await ensureSupplierInvoice({
    number: 'SINV-00002',
    supplierId: sceptreImports.id,
    branchId: retail.id,
    supplierInvoiceNumber: 'GIKIMP-7781',
    invoiceDate: '2026-10-08',
    dueDate: '2026-10-22',
    note: 'Standalone invoice — no stock receipt',
    tax: 'NONE',
    lines: [
      {
        description: 'Freight and clearing — Tema port',
        quantity: 1,
        unitCostMinor: 35_000,
      },
    ],
  })
  if (standaloneInvoice.created) created.push('supplier invoice SINV-00002 @ ACC-SPX')

  if (
    await ensureSupplierPayment({
      number: 'PAY-00002',
      supplierId: sceptreImports.id,
      branchId: retail.id,
      method: 'BANK',
      amountMinor: 20_000,
      paidAt: new Date('2026-10-12T09:15:00.000Z'),
      reference: 'GCB-TRF-778812',
      allocations: [],
    })
  ) {
    created.push('supplier payment PAY-00002 @ ACC-SPX (on account)')
  }

  if (await ensureSequenceAtLeast('supplier.codeSequence', 3)) {
    created.push('supplier code sequence')
  }

  if (await ensureSequenceAtLeast('payable.invoiceSequence', 3)) {
    created.push('supplier invoice sequence')
  }

  if (await ensureSequenceAtLeast('payable.paymentSequence', 3)) {
    created.push('supplier payment sequence')
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

  const demoCustomers = [
    {
      name: 'Akosua Mensah',
      phone: '+233241000001',
      email: 'akosua.mensah@example.com',
    },
    {
      name: 'Kwame Boateng',
      phone: '+233241000002',
      address: '22 Spintex Road, Accra',
    },
    {
      name: 'Efua Owusu',
      phone: '+233241000003',
    },
  ] as const

  const customerIds = new Map<string, string>()
  for (const person of demoCustomers) {
    const result = await ensureCustomer({ ...person, createdBranchId: retail.id })
    customerIds.set(person.phone, result.id)
    if (result.created) created.push(`customer ${person.name}`)
  }

  const creditCustomerId = customerIds.get('+233241000001')
  if (
    creditCustomerId &&
    (await ensureCreditOpening({
      customerId: creditCustomerId,
      branchId: retail.id,
      limitMinor: 50_000,
      chargeMinor: 12_000,
      repaymentMinor: 6_000,
      chargeDate: new Date('2026-10-05T09:00:00.000Z'),
      repaymentDate: new Date('2026-10-12T09:00:00.000Z'),
    }))
  ) {
    created.push('credit opening balance Akosua Mensah @ ACC-SPX')
  }

  const loyaltyCustomerId = customerIds.get('+233241000002')
  if (
    loyaltyCustomerId &&
    (await ensureLoyaltyEarn({
      customerId: loyaltyCustomerId,
      branchId: retail.id,
      points: 250,
      idempotencyKey: 'seed-loyalty-welcome-0002',
      occurredAt: new Date('2026-09-20T10:00:00.000Z'),
    }))
  ) {
    created.push('loyalty points Kwame Boateng')
  }

  const posTerminalId = await findTerminalIdByCode('ACC-SPX-T01')
  const demoCashier = await findUserByEmail(DEMO_CASHIER_EMAIL)
  if (posTerminalId && demoCashier?.staffId) {
    const demoDevice = await ensureDevice({
      terminalId: posTerminalId,
      fingerprint: 'seed-ACC-SPX-T01',
    })
    if (demoDevice.created) created.push('device ACC-SPX-T01 (seed)')

    if (await ensureDemoPin(DEMO_CASHIER_EMAIL, '2468')) {
      created.push('demo cashier PIN (2468)')
    }

    const shiftNumber = 'ACC-SPX-T01-S-20261020-01'
    const demoShift = await ensureDemoShift({
      number: shiftNumber,
      branchId: retail.id,
      terminalId: posTerminalId,
      deviceId: demoDevice.id,
      cashierUserId: demoCashier.id,
      cashierStaffId: demoCashier.staffId,
      openedAt: new Date('2026-10-20T08:00:00.000Z'),
      openingFloatMinor: 20_000,
    })
    if (demoShift.created) created.push(`shift ${shiftNumber}`)

    const productFor = (sku: string) => {
      const found = DEMO_PRODUCTS.find((item) => item.sku === sku)
      if (!found) throw new Error(`Demo product ${sku} is missing`)
      return found
    }

    const cashOilFilter = productFor('GIK-00001')
    const cashDensoFilter = productFor('GIK-00002')
    const cashSale = await ensureDemoSale({
      receiptNumber: 'ACC-SPX-T01-20261020-0001',
      shiftId: demoShift.id,
      branchId: retail.id,
      terminalId: posTerminalId,
      deviceId: demoDevice.id,
      cashierUserId: demoCashier.id,
      cashierStaffId: demoCashier.staffId,
      occurredAt: new Date('2026-10-20T10:15:00.000Z'),
      taxMode: 'INCLUSIVE',
      lines: [
        {
          productId: productIdFor(cashOilFilter.sku),
          sku: cashOilFilter.sku,
          name: cashOilFilter.name,
          quantity: 2,
          unitPriceMinor: 7_500,
          lineDiscountMinor: 500,
          taxCategory: 'STANDARD',
        },
        {
          productId: productIdFor(cashDensoFilter.sku),
          sku: cashDensoFilter.sku,
          name: cashDensoFilter.name,
          quantity: 1,
          unitPriceMinor: 8_000,
          taxCategory: 'STANDARD',
        },
      ],
      tender: 'CASH',
      cashTenderedMinor: 30_000,
    })
    if (cashSale.created) created.push('cash sale ACC-SPX-T01-20261020-0001')

    const creditProduct = productFor('GIK-00006')
    const creditCustomerId = customerIds.get('+233241000001')
    const creditSale = creditCustomerId
      ? await ensureDemoSale({
          receiptNumber: 'ACC-SPX-T01-20261020-0002',
          shiftId: demoShift.id,
          branchId: retail.id,
          terminalId: posTerminalId,
          deviceId: demoDevice.id,
          cashierUserId: demoCashier.id,
          cashierStaffId: demoCashier.staffId,
          customerId: creditCustomerId,
          occurredAt: new Date('2026-10-20T11:05:00.000Z'),
          taxMode: 'INCLUSIVE',
          lines: [
            {
              productId: productIdFor(creditProduct.sku),
              sku: creditProduct.sku,
              name: creditProduct.name,
              quantity: 1,
              unitPriceMinor: 18_500,
              taxCategory: 'STANDARD',
            },
          ],
          tender: 'CREDIT',
          creditLimitMinor: 50_000,
          priceSource: 'OVERRIDE',
        })
      : null
    if (creditSale?.created) created.push('credit sale ACC-SPX-T01-20261020-0002')

    if (
      await closeDemoShift({
        number: shiftNumber,
        closedAt: new Date('2026-10-20T20:00:00.000Z'),
        countedCashMinor: 20_000 + cashSale.totalMinor,
        expectedCashMinor: 20_000 + cashSale.totalMinor,
      })
    ) {
      created.push(`closed shift ${shiftNumber}`)
    }

    if (
      await ensureDemoConflict({
        branchId: retail.id,
        terminalId: posTerminalId,
        deviceId: demoDevice.id,
        saleId: cashSale.saleId,
        type: 'PRICE_MISMATCH',
        severity: 'MEDIUM',
        details: {
          note: 'Demo resolved price mismatch',
          chargedUnitPriceMinor: 7_500,
          expectedUnitPriceMinor: 7_800,
        },
      })
    ) {
      created.push('sample resolved sync conflict')
    }
  }

  if (await ensureSequenceAtLeast('credit.repaymentSequence', 2)) {
    created.push('credit repayment sequence')
  }

  if (await ensureSequenceAtLeast('inventory.receiptSequence', 3)) {
    created.push('inventory receipt sequence')
  }

  if (await ensureSequenceAtLeast('catalog.skuSequence', DEMO_PRODUCTS.length + 1)) {
    created.push('catalog sequence')
  }

  // Phase 12: the retail branch starts with one monthly ABC:A schedule, and the
  // classes it would count are derived from the stock and sales above, so the
  // console and the manager's view are not empty on a fresh seed (P12-D28, D29).
  if (
    await ensureCountSchedule({
      branchId: retail.id,
      scope: 'ABC_CLASS',
      scopeKey: 'ABC:A',
      frequency: 'MONTHLY',
      nextDueAt: '2026-11-01',
    })
  ) {
    created.push('count schedule ABC:A @ ACC-SPX')
  }
  await computeAbcClasses(retail.id)

  return { created }
}
