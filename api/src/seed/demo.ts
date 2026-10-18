import { db } from '@gikautos/db'
import {
  createUserWithCredential,
  ensureBranch,
  ensureSetting,
  ensureTerminal,
  findUserByEmail,
} from './helpers.ts'

export interface SeedDemoResult {
  created: string[]
}

const DEMO_MANAGER_EMAIL = 'manager@gikautos.local'
const DEMO_CASHIER_EMAIL = 'cashier@gikautos.local'
const DEMO_PASSWORD_DEFAULT = 'demo-password-1234'

/**
 * Development-only demo data: a retail branch, a warehouse, one terminal per
 * branch, a manager, and a cashier. Idempotent; catalog demo data arrives in
 * Phase 2.
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
  if (await ensureTerminal({ branchId: warehouse.id, code: 'ACC-WH1-T01', name: 'Warehouse 1' })) {
    created.push('terminal ACC-WH1-T01')
  }

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
  ])
  if (settingsSeeded.some(Boolean)) created.push('settings defaults')

  return { created }
}
