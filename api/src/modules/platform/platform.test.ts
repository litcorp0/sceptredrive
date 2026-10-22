import { db } from '@gikautos/db'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  randomToken,
  signIn,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { branch } from '../org/branches.schema.ts'
import { auditLog } from './audit.schema.ts'
import * as auditService from './audit.service.ts'
import { setting } from './settings.schema.ts'
import { advanceSequencePast, allocateFromSequence, peekSequenceValue } from './settings.service.ts'

const available = await databaseAvailable()
if (!available) console.warn('[platform.test] database unavailable; integration tests skipped')

interface AuditEntry {
  id: string
  action: string
  entity: string
  entityId: string | null
  actorStaffId: string | null
  branchId: string | null
  createdAt: string
}

interface SettingsResponse {
  settings: { key: string; value: unknown; branchScoped: boolean; source: string }[]
  branchId: string | null
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe.skipIf(!available)('audit and settings API', () => {
  const createdUserIds: string[] = []
  const createdBranchIds: string[] = []
  let adminCookie = ''
  let managerCookie = ''
  let branchAId = ''
  let branchBId = ''
  const suffix = randomToken(3)

  async function createBranchAsAdmin(code: string, name: string): Promise<string> {
    const response = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ code, name, type: 'RETAIL', city: 'Accra' }),
    })
    expect(response.status).toBe(201)
    const body = await readJson<{ branch: { id: string } }>(response)
    createdBranchIds.push(body.branch.id)
    return body.branch.id
  }

  beforeAll(async () => {
    const admin = await createTestUser({ role: 'ADMIN', name: 'Platform Admin' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    branchAId = await createBranchAsAdmin(`T${suffix}-A`, 'Platform Branch A')
    branchBId = await createBranchAsAdmin(`T${suffix}-B`, 'Platform Branch B')

    const manager = await createTestUser({
      role: 'MANAGER',
      branchId: branchAId,
      name: 'Platform Manager',
    })
    createdUserIds.push(manager.id)
    managerCookie = await signIn(manager.email)
  })

  afterAll(async () => {
    await db
      .delete(setting)
      .where(inArray(setting.key, ['staff.idPrefix', 'receipt.header', 'credit.repaymentSequence']))
    for (const id of createdUserIds) await deleteTestUser(id)
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  it('keeps the audit service append-only', () => {
    expect(Object.keys(auditService).sort()).toEqual(['queryAudit', 'writeAudit'])
  })

  it('paginates and orders audit entries newest first', async () => {
    const response = await app.request('/api/audit?limit=2', {
      headers: authedHeaders(adminCookie),
    })

    expect(response.status).toBe(200)
    const body = await readJson<{ entries: AuditEntry[]; total: number }>(response)
    expect(body.entries.length).toBeLessThanOrEqual(2)
    expect(body.total).toBeGreaterThanOrEqual(body.entries.length)
    if (body.entries.length === 2) {
      const [first, second] = body.entries
      expect(new Date(first?.createdAt ?? 0).getTime()).toBeGreaterThanOrEqual(
        new Date(second?.createdAt ?? 0).getTime(),
      )
    }

    const offsetResponse = await app.request('/api/audit?limit=2&offset=1', {
      headers: authedHeaders(adminCookie),
    })
    const offsetBody = await readJson<{ entries: AuditEntry[] }>(offsetResponse)
    expect(offsetBody.entries[0]?.id).not.toBe(body.entries[0]?.id)
  })

  it('filters audit entries by entity, entity id, action, and date range', async () => {
    const filtered = await app.request(
      `/api/audit?entity=branch&entityId=${branchAId}&action=branch.created`,
      { headers: authedHeaders(adminCookie) },
    )
    expect(filtered.status).toBe(200)
    const filteredBody = await readJson<{ entries: AuditEntry[]; total: number }>(filtered)
    expect(filteredBody.total).toBeGreaterThanOrEqual(1)
    expect(
      filteredBody.entries.every(
        (entry) =>
          entry.entity === 'branch' &&
          entry.entityId === branchAId &&
          entry.action === 'branch.created',
      ),
    ).toBe(true)

    const from = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    const recent = await app.request(`/api/audit?from=${from}`, {
      headers: authedHeaders(adminCookie),
    })
    const recentBody = await readJson<{ entries: AuditEntry[]; total: number }>(recent)
    expect(recentBody.total).toBeGreaterThanOrEqual(1)

    const past = new Date(Date.now() - 60 * 60 * 1000).toISOString()
    const old = await app.request(`/api/audit?to=${past}&entity=branch&entityId=${branchAId}`, {
      headers: authedHeaders(adminCookie),
    })
    const oldBody = await readJson<{ total: number }>(old)
    expect(oldBody.total).toBe(0)
  })

  it('filters audit entries by actor staff id', async () => {
    await auditService.writeAudit({
      action: 'test.actor-filter',
      entity: 'test',
      actorStaffId: 'GA-TEST-1',
    })

    const filtered = await app.request('/api/audit?actorStaffId=GA-TEST-1', {
      headers: authedHeaders(adminCookie),
    })
    expect(filtered.status).toBe(200)
    const body = await readJson<{ entries: AuditEntry[] }>(filtered)
    expect(body.entries.length).toBeGreaterThanOrEqual(1)
    expect(body.entries.every((entry) => entry.actorStaffId === 'GA-TEST-1')).toBe(true)
  })

  it('scopes audit reads to the manager branch', async () => {
    const scoped = await app.request('/api/audit?limit=200', {
      headers: authedHeaders(managerCookie),
    })
    expect(scoped.status).toBe(200)
    const scopedBody = await readJson<{ entries: AuditEntry[] }>(scoped)
    expect(scopedBody.entries.length).toBeGreaterThanOrEqual(1)
    expect(scopedBody.entries.every((entry) => entry.branchId === branchAId)).toBe(true)

    const crossBranchFilter = await app.request(`/api/audit?branchId=${branchBId}`, {
      headers: authedHeaders(managerCookie),
    })
    expect(crossBranchFilter.status).toBe(403)

    const otherBranchEntity = await app.request(`/api/audit?entity=branch&entityId=${branchBId}`, {
      headers: authedHeaders(managerCookie),
    })
    const otherBody = await readJson<{ total: number }>(otherBranchEntity)
    expect(otherBody.total).toBe(0)
  })

  it('lists typed settings with defaults', async () => {
    const response = await app.request('/api/settings', {
      headers: authedHeaders(adminCookie),
    })

    expect(response.status).toBe(200)
    const body = await readJson<SettingsResponse>(response)
    const prefix = body.settings.find((item) => item.key === 'staff.idPrefix')
    expect(prefix?.value).toBe('GA')
    expect(prefix?.source).not.toBe('branch')

    const minimumRedeem = body.settings.find((item) => item.key === 'loyalty.minimumRedeemPoints')
    expect(minimumRedeem?.value).toBe(100)

    const cashierDiscount = body.settings.find(
      (item) => item.key === 'pos.maxCashierDiscountPercent',
    )
    expect(cashierDiscount?.value).toBe(0)
    expect(cashierDiscount?.source).toBe('default')

    const receiptFooter = body.settings.find((item) => item.key === 'pos.receiptFooter')
    expect(receiptFooter?.value).toBe('Thank you for your business')

    const requireShift = body.settings.find((item) => item.key === 'pos.salesRequireOpenShift')
    expect(requireShift?.value).toBe(true)
  })

  it('updates global settings as admin and audits the change', async () => {
    const response = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ key: 'staff.idPrefix', value: 'GX' }),
    })

    expect(response.status).toBe(200)

    const list = await app.request('/api/settings', { headers: authedHeaders(adminCookie) })
    const body = await readJson<SettingsResponse>(list)
    const prefix = body.settings.find((item) => item.key === 'staff.idPrefix')
    expect(prefix?.value).toBe('GX')
    expect(prefix?.source).toBe('global')

    const auditRows = await db.select().from(auditLog).where(eq(auditLog.action, 'setting.updated'))
    expect(auditRows.some((row) => row.entityId === 'staff.idPrefix')).toBe(true)
  })

  it('validates setting keys and values', async () => {
    const unknownKey = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ key: 'nope.key', value: 1 }),
    })
    expect(unknownKey.status).toBe(400)

    const badValue = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ key: 'staff.idPrefix', value: 'way-too-long-prefix' }),
    })
    expect(badValue.status).toBe(400)

    const fractionalEarn = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ key: 'loyalty.earnPointsPerCedi', value: 1.5 }),
    })
    expect(fractionalEarn.status).toBe(400)

    const badSupplierPrefix = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ key: 'supplier.codePrefix', value: 'bad prefix!' }),
    })
    expect(badSupplierPrefix.status).toBe(400)

    const zeroInvoiceSequence = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ key: 'payable.invoiceSequence', value: 0 }),
    })
    expect(zeroInvoiceSequence.status).toBe(400)

    const discountOutOfRange = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ key: 'pos.maxCashierDiscountPercent', value: 101 }),
    })
    expect(discountOutOfRange.status).toBe(400)

    const tooFewPinAttempts = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ key: 'pos.pinMaxAttempts', value: 2 }),
    })
    expect(tooFewPinAttempts.status).toBe(400)

    const oversizedBatch = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ key: 'pos.syncBatchSize', value: 51 }),
    })
    expect(oversizedBatch.status).toBe(400)

    const emptyFooter = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ key: 'pos.receiptFooter', value: '' }),
    })
    expect(emptyFooter.status).toBe(400)
  })

  it('allocates inventory document numbers from their sequences', async () => {
    const first = await allocateFromSequence('inventory.receiptSequence', db)
    const second = await allocateFromSequence('inventory.receiptSequence', db)
    expect(first).toMatch(/^GRN-\d{5}$/)
    expect(Number(second.split('-')[1])).toBe(Number(first.split('-')[1]) + 1)

    const peeked = await peekSequenceValue('inventory.receiptSequence', db)
    expect(await peekSequenceValue('inventory.receiptSequence', db)).toBe(peeked)
    expect(await allocateFromSequence('inventory.receiptSequence', db)).toBe(peeked)

    expect(await allocateFromSequence('inventory.transferSequence', db)).toMatch(/^TRF-\d{5}$/)
    expect(await allocateFromSequence('inventory.countSequence', db)).toMatch(/^CNT-\d{5}$/)

    await advanceSequencePast('inventory.countSequence', 'CNT-00090', db)
    const afterAdvance = await allocateFromSequence('inventory.countSequence', db)
    expect(Number(afterAdvance.split('-')[1])).toBeGreaterThan(90)

    const repayment = await allocateFromSequence('credit.repaymentSequence', db)
    expect(repayment).toMatch(/^REP-\d{5}$/)
    await advanceSequencePast('credit.repaymentSequence', 'REP-00042', db)
    const afterRepaymentAdvance = await allocateFromSequence('credit.repaymentSequence', db)
    expect(Number(afterRepaymentAdvance.split('-')[1])).toBeGreaterThan(42)

    expect(await allocateFromSequence('supplier.codeSequence', db)).toMatch(/^SUP-\d{5}$/)
    expect(await allocateFromSequence('payable.invoiceSequence', db)).toMatch(/^SINV-\d{5}$/)
    expect(await allocateFromSequence('payable.paymentSequence', db)).toMatch(/^PAY-\d{5}$/)

    await advanceSequencePast('payable.invoiceSequence', 'SINV-00077', db)
    const afterInvoiceAdvance = await allocateFromSequence('payable.invoiceSequence', db)
    expect(Number(afterInvoiceAdvance.split('-')[1])).toBeGreaterThan(77)
  })

  it('forbids managers from changing global settings', async () => {
    const response = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ key: 'staff.idPrefix', value: 'MX' }),
    })

    expect(response.status).toBe(403)

    const creditAttempt = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ key: 'credit.repaymentPrefix', value: 'RCP' }),
    })
    expect(creditAttempt.status).toBe(403)

    const supplierAttempt = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ key: 'supplier.codePrefix', value: 'VEN' }),
    })
    expect(supplierAttempt.status).toBe(403)

    const payableAttempt = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ key: 'payable.invoicePrefix', value: 'BILL' }),
    })
    expect(payableAttempt.status).toBe(403)

    const posAttempt = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ key: 'pos.maxCashierDiscountPercent', value: 10 }),
    })
    expect(posAttempt.status).toBe(403)
  })

  it('lets managers set branch-scoped settings for their branch only', async () => {
    const update = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ key: 'receipt.header', value: 'Branch A welcomes you' }),
    })
    expect(update.status).toBe(200)
    const updateBody = await readJson<{ setting: { source: string; value: unknown } }>(update)
    expect(updateBody.setting.source).toBe('branch')

    const managerList = await app.request('/api/settings', {
      headers: authedHeaders(managerCookie),
    })
    const managerBody = await readJson<SettingsResponse>(managerList)
    const header = managerBody.settings.find((item) => item.key === 'receipt.header')
    expect(header?.value).toBe('Branch A welcomes you')
    expect(header?.source).toBe('branch')

    const adminGlobal = await app.request('/api/settings', {
      headers: authedHeaders(adminCookie),
    })
    const adminGlobalBody = await readJson<SettingsResponse>(adminGlobal)
    expect(adminGlobalBody.settings.find((item) => item.key === 'receipt.header')?.source).not.toBe(
      'branch',
    )

    const adminBranch = await app.request(`/api/settings?branchId=${branchAId}`, {
      headers: authedHeaders(adminCookie),
    })
    const adminBranchBody = await readJson<SettingsResponse>(adminBranch)
    expect(adminBranchBody.settings.find((item) => item.key === 'receipt.header')?.value).toBe(
      'Branch A welcomes you',
    )

    const crossUpdate = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ key: 'receipt.header', value: 'Nope', branchId: branchBId }),
    })
    expect(crossUpdate.status).toBe(403)

    const crossRead = await app.request(`/api/settings?branchId=${branchBId}`, {
      headers: authedHeaders(managerCookie),
    })
    expect(crossRead.status).toBe(403)
  })
})
