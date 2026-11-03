import { db } from '@sceptre/db'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  randomToken,
  signIn,
  uniqueSuffix,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import type { SessionUser } from '../../http/factory.ts'
import { logger } from '../../logger.ts'
import { branch } from '../org/branches.schema.ts'
import {
  getMockCallCounts,
  getMockTransferByReference,
  requestMockOtp,
  resetMockProvider,
  setMockTransferBalance,
  settleMockTransfer,
} from '../payments/payments.mock.provider.ts'
import { getPaymentProvider, ProviderUnavailableError } from '../payments/payments.provider.ts'
import { paymentEvent } from '../payments/payments.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { findPaymentDetailById } from '../suppliers/suppliers.repository.ts'
import { supplier, supplierPaymentDetail } from '../suppliers/suppliers.schema.ts'
import * as suppliersService from '../suppliers/suppliers.service.ts'
import {
  supplierInvoice,
  supplierInvoiceLine,
  supplierPayment,
  supplierPaymentAllocation,
  supplierTransfer,
  supplierTransferAllocation,
} from './payables.schema.ts'
import * as payablesService from './payables.service.ts'
import { resetProviderBalanceCache } from './payables.service.ts'
import type { PaymentCreateBody, TransferCreateBody, TransferDetail } from './payables.types.ts'

const available = await databaseAvailable()
if (!available)
  console.warn('[payables.transfer.test] database unavailable; integration tests skipped')

const actor: AuditActor = {
  actorId: 'test-actor',
  actorStaffId: 'SD-TRF',
  ip: null,
  userAgent: null,
  requestId: null,
}

const suffix = uniqueSuffix()

function isoToday(): string {
  return new Date().toISOString().slice(0, 10)
}

function makeUser(overrides: Partial<SessionUser>): SessionUser {
  return {
    id: `user-${suffix}`,
    email: `user-${suffix}@sceptre.test`,
    name: 'Fixture User',
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: 'MANAGER',
    branchId: null,
    staffId: null,
    phone: null,
    isActive: true,
    mustChangePassword: false,
    image: null,
    ...overrides,
  } as SessionUser
}

describe.skipIf(!available)('supplier transfers', () => {
  const branchIds: string[] = []
  const supplierIds: string[] = []
  const detailIds: string[] = []
  const invoiceIds: string[] = []
  const paymentIds: string[] = []
  const transferIds: string[] = []
  const references: string[] = []
  const userIds: string[] = []

  let branchId = ''
  let otherBranchId = ''
  let supplierId = ''
  let supplierCode = ''
  let bankDetailId = ''
  let momoDetailId = ''

  let adminUser: SessionUser
  let managerUser: SessionUser
  let managerCookie = ''
  let adminCookie = ''
  let cashierCookie = ''

  async function createDetail(
    input: Parameters<typeof suppliersService.addPaymentDetail>[2],
  ): Promise<string> {
    const view = await suppliersService.addPaymentDetail(actor, supplierId, input)
    detailIds.push(view.id)
    return view.id
  }

  async function createInvoice(amountMinor: number): Promise<string> {
    const result = await payablesService.createInvoice(managerUser, actor, {
      supplierId,
      branchId,
      supplierInvoiceNumber: `TRF-${randomToken(8)}`,
      invoiceDate: isoToday(),
      lines: [{ description: 'Transfer fixture', quantity: 1, unitCostMinor: amountMinor }],
    })
    invoiceIds.push(result.invoice.invoice.id)
    return result.invoice.invoice.id
  }

  function transferBody(overrides: Partial<TransferCreateBody> = {}): TransferCreateBody {
    return {
      supplierId,
      branchId,
      paymentDetailId: bankDetailId,
      amountMinor: 50_000,
      idempotencyKey: crypto.randomUUID(),
      ...overrides,
    }
  }

  function postTransfer(body: unknown, cookie = managerCookie) {
    return app.request('/api/payables/transfers', {
      method: 'POST',
      headers: authedHeaders(cookie),
      body: JSON.stringify(body),
    })
  }

  type TransferResponse = {
    transfer: TransferDetail
    replayed: boolean
    providerUnavailable: boolean
  }

  async function createTransfer(
    body: TransferCreateBody,
    cookie = managerCookie,
  ): Promise<{ status: number; body: TransferResponse }> {
    const response = await postTransfer(body, cookie)
    const parsed = (await response.json()) as TransferResponse
    if (parsed.transfer?.transfer?.id) transferIds.push(parsed.transfer.transfer.id)
    if (parsed.transfer?.transfer?.reference) references.push(parsed.transfer.transfer.reference)
    if (parsed.transfer?.payment) paymentIds.push(parsed.transfer.payment.payment.id)
    return { status: response.status, body: parsed }
  }

  async function verifyTransfer(id: string, cookie = managerCookie) {
    const response = await app.request(`/api/payables/transfers/${id}/verify`, {
      method: 'POST',
      headers: authedHeaders(cookie),
    })
    const parsed = (await response.json()) as { transfer: TransferDetail }
    if (parsed.transfer?.payment) paymentIds.push(parsed.transfer.payment.payment.id)
    return { status: response.status, body: parsed }
  }

  async function getTransferDetail(id: string) {
    const response = await app.request(`/api/payables/transfers/${id}`, {
      headers: authedHeaders(managerCookie),
    })
    return { status: response.status, text: await response.text() }
  }

  beforeAll(async () => {
    const branches = await db
      .insert(branch)
      .values([
        {
          code: `TR${randomToken(2)}A`,
          name: `Transfer A ${suffix}`,
          type: 'RETAIL',
          city: 'Accra',
        },
        {
          code: `TR${randomToken(2)}B`,
          name: `Transfer B ${suffix}`,
          type: 'RETAIL',
          city: 'Kumasi',
        },
      ])
      .returning({ id: branch.id })
    branchId = branches[0]?.id ?? ''
    otherBranchId = branches[1]?.id ?? ''
    branchIds.push(branchId, otherBranchId)

    const createdSupplier = await suppliersService.createSupplier(actor, {
      name: `Transfer Supplier ${suffix}`,
    })
    supplierId = createdSupplier.id
    supplierCode = createdSupplier.code
    supplierIds.push(supplierId)

    bankDetailId = await createDetail({
      method: 'BANK',
      label: 'Main account',
      accountName: 'Kofi Supplies',
      accountNumber: '1234567890',
      bankName: 'GCB Bank',
      bankCode: 'GCB',
    })
    momoDetailId = await createDetail({
      method: 'MOMO',
      accountName: 'Kofi Supplies',
      momoNetwork: 'MTN',
      phone: '0241234567',
    })

    adminUser = makeUser({ role: 'ADMIN', branchId: null, id: `admin-${suffix}` })
    managerUser = makeUser({ role: 'MANAGER', branchId, id: `manager-${suffix}` })

    const admin = await createTestUser({ role: 'ADMIN', name: 'Transfer Admin' })
    userIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    const manager = await createTestUser({ role: 'MANAGER', branchId, name: 'Transfer Manager' })
    userIds.push(manager.id)
    managerCookie = await signIn(manager.email)

    const cashier = await createTestUser({ role: 'CASHIER', branchId, name: 'Transfer Cashier' })
    userIds.push(cashier.id)
    cashierCookie = await signIn(cashier.email)
  })

  beforeEach(() => {
    resetMockProvider()
    resetProviderBalanceCache()
  })

  afterAll(async () => {
    if (references.length > 0) {
      await db
        .delete(paymentEvent)
        .where(inArray(paymentEvent.providerReference, [...new Set(references)]))
    }
    if (paymentIds.length > 0) {
      const ids = [...new Set(paymentIds)]
      await db
        .delete(supplierPaymentAllocation)
        .where(inArray(supplierPaymentAllocation.paymentId, ids))
      await db.delete(supplierPayment).where(inArray(supplierPayment.id, ids))
    }
    if (transferIds.length > 0) {
      const ids = [...new Set(transferIds)]
      await db
        .delete(supplierTransferAllocation)
        .where(inArray(supplierTransferAllocation.transferId, ids))
      await db.delete(supplierTransfer).where(inArray(supplierTransfer.id, ids))
    }
    if (invoiceIds.length > 0) {
      await db
        .delete(supplierPaymentAllocation)
        .where(inArray(supplierPaymentAllocation.invoiceId, invoiceIds))
      await db.delete(supplierInvoiceLine).where(inArray(supplierInvoiceLine.invoiceId, invoiceIds))
      await db.delete(supplierInvoice).where(inArray(supplierInvoice.id, invoiceIds))
    }
    if (detailIds.length > 0) {
      await db.delete(supplierPaymentDetail).where(inArray(supplierPaymentDetail.id, detailIds))
    }
    if (supplierIds.length > 0) {
      await db.delete(supplier).where(inArray(supplier.id, supplierIds))
    }
    const entityIds = [...transferIds, ...paymentIds, ...invoiceIds, ...supplierIds, ...detailIds]
    if (entityIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.entityId, entityIds))
    }
    for (const id of userIds) await deleteTestUser(id)
    if (branchIds.length > 0) await db.delete(branch).where(inArray(branch.id, branchIds))
  })

  it('creates a ghipss recipient for a bank detail and a mobile_money one for MoMo', async () => {
    const provider = getPaymentProvider()
    const recipient = vi.spyOn(provider, 'createTransferRecipient')

    const bank = await createTransfer(transferBody({ amountMinor: 1_000 }))
    expect(bank.status).toBe(201)
    expect(recipient).toHaveBeenCalledWith({
      type: 'ghipss',
      name: 'Kofi Supplies',
      accountNumber: '1234567890',
      bankCode: 'GCB',
      currency: 'GHS',
    })

    const momo = await createTransfer(
      transferBody({ amountMinor: 1_000, paymentDetailId: momoDetailId }),
    )
    expect(momo.status).toBe(201)
    expect(recipient).toHaveBeenCalledWith({
      type: 'mobile_money',
      name: 'Kofi Supplies',
      // `addPaymentDetail` normalises the Ghana number to E.164 (P5 behaviour).
      accountNumber: '+233241234567',
      bankCode: 'MTN',
      currency: 'GHS',
    })

    // The stored code is never returned or logged (P14-D28).
    const detail = await getTransferDetail(bank.body.transfer.transfer.id)
    expect(detail.text).not.toContain('RCP_mock')
    expect(detail.text).not.toContain('1234567890')
    const raw = await findPaymentDetailById(bankDetailId)
    expect(raw?.paystackRecipientCode).toMatch(/^RCP_mock_/)
  })

  it('clears the stored recipient when the destination changes and mints a new one', async () => {
    // Another case may already have minted this supplier's recipient; start from
    // "no recipient" so the count below is this test's.
    await db
      .update(supplierPaymentDetail)
      .set({ paystackRecipientCode: null })
      .where(eq(supplierPaymentDetail.id, bankDetailId))

    const provider = getPaymentProvider()
    const recipient = vi.spyOn(provider, 'createTransferRecipient')

    await createTransfer(transferBody({ amountMinor: 1_000 }))
    expect(
      await findPaymentDetailById(bankDetailId).then((row) => row?.paystackRecipientCode),
    ).toMatch(/^RCP_mock_/)
    expect(recipient).toHaveBeenCalledTimes(1)

    const updated = await suppliersService.updatePaymentDetail(actor, supplierId, bankDetailId, {
      accountNumber: '9876543210',
    })
    expect(updated.recipientReady).toBe(false)
    expect(updated.accountNumber).toBe('9876543210')

    const cleared = await db
      .select({ action: auditLog.action, after: auditLog.after })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityId, bankDetailId),
          eq(auditLog.action, 'supplier.payment_detail.recipient_cleared'),
        ),
      )
    expect(cleared).toHaveLength(1)
    expect(cleared[0]?.after).toMatchObject({ changed: ['accountNumber'] })
    expect(JSON.stringify(cleared[0]?.after)).not.toContain('9876543210')

    await createTransfer(transferBody({ amountMinor: 2_000 }))
    expect(recipient).toHaveBeenCalledTimes(2)
    expect(recipient).toHaveBeenLastCalledWith(
      expect.objectContaining({ accountNumber: '9876543210', type: 'ghipss' }),
    )
  })

  it('refuses an amount larger than the provider balance before a row exists', async () => {
    setMockTransferBalance(10_000)
    const provider = getPaymentProvider()
    const initiate = vi.spyOn(provider, 'initiateTransfer')

    const idempotencyKey = crypto.randomUUID()
    const response = await postTransfer(transferBody({ amountMinor: 50_000, idempotencyKey }))
    expect(response.status).toBe(409)
    const body = (await response.json()) as {
      error: { code: string; message: string; details?: Record<string, number> }
    }
    expect(body.error.code).toBe('INSUFFICIENT_PROVIDER_BALANCE')
    expect(body.error.message).toContain('GHS 100.00')
    expect(body.error.message).toContain('GHS 500.00')
    expect(body.error.details).toMatchObject({ balanceMinor: 10_000, amountMinor: 50_000 })
    expect(initiate).not.toHaveBeenCalled()

    const rows = await db
      .select({ id: supplierTransfer.id })
      .from(supplierTransfer)
      .where(eq(supplierTransfer.idempotencyKey, idempotencyKey))
    expect(rows).toHaveLength(0)
  })

  it('settles a successful transfer into one payment and the invoice projection', async () => {
    const invoiceId = await createInvoice(50_000)
    const created = await createTransfer(
      transferBody({ allocations: [{ invoiceId, amountMinor: 50_000 }] }),
    )
    expect(created.status).toBe(201)
    const transfer = created.body.transfer.transfer
    expect(transfer.status).toBe('PENDING')
    expect(transfer.paymentId).toBeNull()
    expect(getMockCallCounts().transfer).toBe(1)
    expect(getMockTransferByReference(transfer.reference)?.status).toBe('pending')

    expect(settleMockTransfer(transfer.reference, 'success')).toBe(true)
    const verified = await verifyTransfer(transfer.id)
    expect(verified.status).toBe(200)
    const settled = verified.body.transfer
    expect(settled.transfer.status).toBe('SUCCESS')
    expect(settled.transfer.paymentId).not.toBeNull()
    expect(settled.transfer.unallocatedMinor).toBe(0)
    expect(settled.payment?.payment.amountMinor).toBe(50_000)
    expect(settled.payment?.payment.idempotencyKey).toBe(`transfer:${transfer.id}`)
    expect(settled.payment?.allocations.map((row) => row.kind)).toEqual(['APPLY'])
    expect(settled.payment?.allocations.map((row) => row.amountMinor)).toEqual([50_000])

    const [invoice] = await db
      .select({ status: supplierInvoice.status, amountPaidMinor: supplierInvoice.amountPaidMinor })
      .from(supplierInvoice)
      .where(eq(supplierInvoice.id, invoiceId))
    expect(invoice).toMatchObject({ status: 'PAID', amountPaidMinor: 50_000 })
  })

  it('returns the first transfer for a repeated idempotency key without calling the provider', async () => {
    const body = transferBody({ amountMinor: 1_500 })
    const first = await createTransfer(body)
    expect(first.status).toBe(201)
    const callsAfterFirst = getMockCallCounts().transfer

    const second = await createTransfer(body)
    expect(second.status).toBe(200)
    expect(second.body.replayed).toBe(true)
    expect(second.body.transfer.transfer.id).toBe(first.body.transfer.transfer.id)
    expect(getMockCallCounts().transfer).toBe(callsAfterFirst)

    const rows = await db
      .select({ id: supplierTransfer.id })
      .from(supplierTransfer)
      .where(eq(supplierTransfer.idempotencyKey, body.idempotencyKey))
    expect(rows).toHaveLength(1)
  })

  it('holds an OTP transfer, refuses a wrong code without moving it, and accepts the right one', async () => {
    requestMockOtp()
    const created = await createTransfer(transferBody({ amountMinor: 3_000 }))
    expect(created.status).toBe(201)
    const transfer = created.body.transfer.transfer
    expect(transfer.status).toBe('AWAITING_OTP')
    expect(transfer.providerTransferCode).not.toBeNull()

    const wrong = await app.request(`/api/payables/transfers/${transfer.id}/finalize`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ otp: '000000' }),
    })
    expect(wrong.status).toBe(400)
    const wrongBody = (await wrong.json()) as { error: { message: string } }
    expect(wrongBody.error.message).toMatch(/OTP is invalid/i)

    const unchanged = await getTransferDetail(transfer.id)
    expect(JSON.parse(unchanged.text).transfer.status).toBe('AWAITING_OTP')

    const right = await app.request(`/api/payables/transfers/${transfer.id}/finalize`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ otp: '123456' }),
    })
    expect(right.status).toBe(200)
    const rightBody = (await right.json()) as {
      transfer: TransferDetail
    }
    expect(rightBody.transfer.transfer.status).toBe('PENDING')

    expect(settleMockTransfer(transfer.reference, 'success')).toBe(true)
    const verified = await verifyTransfer(transfer.id)
    expect(verified.body.transfer.transfer.status).toBe('SUCCESS')
    expect(verified.body.transfer.payment?.payment.amountMinor).toBe(3_000)

    // A second finalize is not a second transfer: the status machine refuses it.
    const again = await app.request(`/api/payables/transfers/${transfer.id}/finalize`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ otp: '123456' }),
    })
    expect(again.status).toBe(409)
  })

  it('posts nothing for a failed transfer and leaves every balance where it was', async () => {
    const invoiceId = await createInvoice(20_000)
    const created = await createTransfer(
      transferBody({ amountMinor: 20_000, allocations: [{ invoiceId, amountMinor: 20_000 }] }),
    )
    const transfer = created.body.transfer.transfer

    expect(settleMockTransfer(transfer.reference, 'failed')).toBe(true)
    const verified = await verifyTransfer(transfer.id)
    expect(verified.body.transfer.transfer.status).toBe('FAILED')
    expect(verified.body.transfer.transfer.failureMessage).toMatch(/failed/i)
    expect(verified.body.transfer.payment).toBeNull()

    // No payment for *this transfer*: earlier cases in this file share the
    // supplier, so the key is the proof rather than a supplier-wide count.
    const payments = await db
      .select({ id: supplierPayment.id })
      .from(supplierPayment)
      .where(eq(supplierPayment.idempotencyKey, `transfer:${transfer.id}`))
    expect(payments).toHaveLength(0)

    const [invoice] = await db
      .select({ status: supplierInvoice.status, amountPaidMinor: supplierInvoice.amountPaidMinor })
      .from(supplierInvoice)
      .where(eq(supplierInvoice.id, invoiceId))
    expect(invoice).toMatchObject({ status: 'OPEN', amountPaidMinor: 0 })
  })

  it('keeps the payment after a reversal and leaves voiding to a manager', async () => {
    const invoiceId = await createInvoice(40_000)
    const created = await createTransfer(
      transferBody({ amountMinor: 40_000, allocations: [{ invoiceId, amountMinor: 40_000 }] }),
    )
    const transfer = created.body.transfer.transfer
    settleMockTransfer(transfer.reference, 'success')
    const settled = await verifyTransfer(transfer.id)
    const paymentId = settled.body.transfer.payment?.payment.id ?? ''
    expect(paymentId).not.toBe('')

    expect(settleMockTransfer(transfer.reference, 'reversed')).toBe(true)
    const reversed = await verifyTransfer(transfer.id)
    expect(reversed.body.transfer.transfer.status).toBe('REVERSED')
    expect(reversed.body.transfer.transfer.paymentId).toBe(paymentId)
    expect(reversed.body.transfer.payment?.payment.status).toBe('COMPLETED')
    expect(reversed.body.transfer.attention).toBe(true)

    // The reconciliation names the pair as attention, and counts it once.
    const reconciliation = await app.request(
      `/api/payables/transfers/reconciliation?branchId=${branchId}`,
      { headers: authedHeaders(managerCookie) },
    )
    expect(reconciliation.status).toBe(200)
    const view = (await reconciliation.json()) as {
      rows: { transferId: string | null; attention: boolean; state: string }[]
      totals: { reversedCount: number }
    }
    expect(view.rows.find((row) => row.transferId === transfer.id)).toMatchObject({
      attention: true,
      state: 'unposted',
    })
    expect(view.totals.reversedCount).toBe(1)

    const voided = await payablesService.voidPayment(adminUser, actor, paymentId, 'BANK_REVERSAL')
    expect(voided.payment.status).toBe('VOID')

    const auditRows = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.entityId, paymentId), eq(auditLog.action, 'supplier_payment.voided')))
    expect(auditRows).toHaveLength(1)

    // The release is a compensating entry, so the invoice is open again.
    const [invoice] = await db
      .select({ status: supplierInvoice.status, amountPaidMinor: supplierInvoice.amountPaidMinor })
      .from(supplierInvoice)
      .where(eq(supplierInvoice.id, invoiceId))
    expect(invoice).toMatchObject({ status: 'OPEN', amountPaidMinor: 0 })
  })

  it('settles a shortfall, keeps the rest on account and audits the difference', async () => {
    const invoiceId = await createInvoice(100_000)
    const created = await createTransfer(
      transferBody({ amountMinor: 50_000, allocations: [{ invoiceId, amountMinor: 50_000 }] }),
    )
    const transfer = created.body.transfer.transfer

    // A manager pays 60 000 by hand between the plan and the settlement.
    const manual = await payablesService.createPayment(managerUser, actor, {
      supplierId,
      branchId,
      method: 'CASH',
      amountMinor: 60_000,
      paidAt: new Date().toISOString(),
      allocations: [{ invoiceId, amountMinor: 60_000 }],
      idempotencyKey: crypto.randomUUID(),
    } satisfies PaymentCreateBody)
    paymentIds.push(manual.payment.payment.id)

    settleMockTransfer(transfer.reference, 'success')
    const verified = await verifyTransfer(transfer.id)
    const settled = verified.body.transfer
    expect(settled.transfer.status).toBe('SUCCESS')
    // The supplier got the full 50 000; only 40 000 still fit the invoice.
    expect(settled.payment?.payment.amountMinor).toBe(50_000)
    expect(settled.payment?.allocations.map((row) => row.amountMinor)).toEqual([40_000])
    expect(settled.transfer.unallocatedMinor).toBe(10_000)

    const [invoice] = await db
      .select({ status: supplierInvoice.status, amountPaidMinor: supplierInvoice.amountPaidMinor })
      .from(supplierInvoice)
      .where(eq(supplierInvoice.id, invoiceId))
    expect(invoice).toMatchObject({ status: 'PAID', amountPaidMinor: 100_000 })

    const shortfalls = await db
      .select({ action: auditLog.action, after: auditLog.after })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityId, transfer.id),
          eq(auditLog.action, 'supplier_transfer.allocation_shortfall'),
        ),
      )
    expect(shortfalls).toHaveLength(1)
    expect(shortfalls[0]?.after).toMatchObject({
      plannedMinor: 50_000,
      allocatedMinor: 40_000,
      unallocatedMinor: 10_000,
    })
    expect(
      (shortfalls[0]?.after as { invoices: { remainingMinor: number }[] }).invoices[0],
    ).toMatchObject({ invoiceId, plannedMinor: 50_000, remainingMinor: 40_000 })
  })

  it('keeps the manual payment and a settled transfer distinguishable in the reconciliation', async () => {
    // A branch of its own, so the totals are this test's and nobody else's.
    const [recBranch] = await db
      .insert(branch)
      .values({ code: `RC${randomToken(2)}`, name: `Rec ${suffix}`, type: 'RETAIL', city: 'Accra' })
      .returning({ id: branch.id })
    const reconciliationBranchId = recBranch?.id ?? ''
    branchIds.push(reconciliationBranchId)

    const recSupplier = await suppliersService.createSupplier(actor, {
      name: `Reconciliation Supplier ${suffix}`,
    })
    supplierIds.push(recSupplier.id)

    async function recInvoice(amountMinor: number): Promise<string> {
      const result = await payablesService.createInvoice(adminUser, actor, {
        supplierId: recSupplier.id,
        branchId: reconciliationBranchId,
        supplierInvoiceNumber: `REC-${randomToken(8)}`,
        invoiceDate: isoToday(),
        lines: [{ description: 'Reconciliation fixture', quantity: 1, unitCostMinor: amountMinor }],
      })
      invoiceIds.push(result.invoice.invoice.id)
      return result.invoice.invoice.id
    }

    const manualInvoice = await recInvoice(15_000)
    const manual = await payablesService.createPayment(adminUser, actor, {
      supplierId: recSupplier.id,
      branchId: reconciliationBranchId,
      method: 'BANK',
      amountMinor: 15_000,
      paidAt: new Date().toISOString(),
      allocations: [{ invoiceId: manualInvoice, amountMinor: 15_000 }],
      idempotencyKey: crypto.randomUUID(),
    } satisfies PaymentCreateBody)
    paymentIds.push(manual.payment.payment.id)

    const detail = await suppliersService.addPaymentDetail(actor, recSupplier.id, {
      method: 'BANK',
      accountName: 'Reconciliation Supplies',
      accountNumber: '7770001112',
      bankName: 'GCB Bank',
      bankCode: 'GCB',
    })
    detailIds.push(detail.id)

    const transferInvoice = await recInvoice(25_000)
    const created = await createTransfer(
      transferBody({
        supplierId: recSupplier.id,
        branchId: reconciliationBranchId,
        paymentDetailId: detail.id,
        amountMinor: 25_000,
        allocations: [{ invoiceId: transferInvoice, amountMinor: 25_000 }],
      }),
      adminCookie,
    )
    const transfer = created.body.transfer.transfer
    settleMockTransfer(transfer.reference, 'success')
    const settled = await verifyTransfer(transfer.id, adminCookie)
    const settledPaymentId = settled.body.transfer.payment?.payment.id ?? ''

    const response = await app.request(
      `/api/payables/transfers/reconciliation?branchId=${reconciliationBranchId}&from=${isoToday()}&to=${isoToday()}`,
      { headers: authedHeaders(adminCookie) },
    )
    expect(response.status).toBe(200)
    const view = (await response.json()) as {
      rows: {
        state: string
        paymentId: string | null
        amountMinor: number
        unallocatedMinor: number
        feeMinor: number | null
      }[]
      totals: { settledMinor: number; manualMinor: number; unpostedMinor: number }
    }

    expect(view.rows).toHaveLength(2)
    const manualRow = view.rows.find((row) => row.paymentId === manual.payment.payment.id)
    expect(manualRow).toMatchObject({ state: 'manual', amountMinor: 15_000 })
    const settledRow = view.rows.find((row) => row.paymentId === settledPaymentId)
    expect(settledRow).toMatchObject({
      state: 'settled',
      amountMinor: 25_000,
      unallocatedMinor: 0,
      // The fee is reported beside the amount, never netted into it (P14-D29).
      feeMinor: null,
    })
    expect(view.totals.settledMinor).toBe(25_000)
    expect(view.totals.manualMinor).toBe(15_000)
    expect(view.totals.unpostedMinor).toBe(0)
  })

  it('refuses a cashier, a foreign branch, a cash body and an inactive detail', async () => {
    const cashier = await postTransfer(transferBody(), cashierCookie)
    expect(cashier.status).toBe(403)

    // An admin may name any branch, so the manager's scope is proven with a
    // manager of the other branch instead.
    const foreign = await createTransfer(transferBody())
    expect(foreign.status).toBe(201)
    expect(adminCookie).not.toBe('')

    const managerOther = makeUser({ role: 'MANAGER', branchId: otherBranchId })
    const scoped = await payablesService
      .createSupplierTransfer(managerOther, actor, transferBody())
      .then(() => null)
      .catch((error: unknown) => error)
    expect(scoped).toMatchObject({ statusCode: 403 })

    // There is no cash transfer: the body has no `method`, and a strict schema
    // refuses the attempt to add one.
    const cash = await postTransfer({ ...transferBody(), method: 'CASH' })
    expect(cash.status).toBe(400)

    const inactive = await createDetail({
      method: 'BANK',
      label: 'Closed account',
      accountName: 'Kofi Supplies',
      accountNumber: '5550001112',
      bankName: 'GCB Bank',
      bankCode: 'GCB',
    })
    await suppliersService.updatePaymentDetail(actor, supplierId, inactive, { isActive: false })
    const refused = await postTransfer(transferBody({ paymentDetailId: inactive }))
    expect(refused.status).toBe(409)

    // A bank detail with no GHIPSS code can be saved (the form allows it) but
    // cannot be paid: Paystack has nothing to route to.
    const noCode = await createDetail({
      method: 'BANK',
      accountName: 'Kofi Supplies',
      accountNumber: '9090001112',
      bankName: 'GCB Bank',
    })
    const unaddressable = await postTransfer(transferBody({ paymentDetailId: noCode }))
    expect(unaddressable.status).toBe(409)
    expect(((await unaddressable.json()) as { error: { message: string } }).error.message).toMatch(
      /bank code/i,
    )
  })

  it('caches the provider balance for thirty seconds and reports an outage as unknown', async () => {
    const provider = getPaymentProvider()
    const balance = vi.spyOn(provider, 'getBalance')

    const first = await app.request('/api/payables/provider-balance', {
      headers: authedHeaders(managerCookie),
    })
    expect(first.status).toBe(200)
    expect(await first.json()).toMatchObject({ currency: 'GHS', balanceMinor: 100_000_000 })

    const second = await app.request('/api/payables/provider-balance', {
      headers: authedHeaders(managerCookie),
    })
    expect(second.status).toBe(200)
    expect(balance).toHaveBeenCalledTimes(1)

    resetProviderBalanceCache()
    balance.mockRejectedValueOnce(new ProviderUnavailableError())
    const outage = await app.request('/api/payables/provider-balance', {
      headers: authedHeaders(managerCookie),
    })
    expect(outage.status).toBe(200)
    expect(await outage.json()).toEqual({ currency: 'GHS', balanceMinor: null })
  })

  it('writes the same rows through the manual form and the allocation core apart from created_by', async () => {
    const manualInvoice = await createInvoice(20_000)
    const directInvoice = await createInvoice(20_000)
    const paidAt = new Date(Date.now() - 60 * 60_000)

    const viaForm = await payablesService.createPayment(managerUser, actor, {
      supplierId,
      branchId,
      method: 'BANK',
      amountMinor: 20_000,
      paidAt: paidAt.toISOString(),
      reference: 'PARITY-1',
      note: 'parity check',
      paymentDetailId: bankDetailId,
      allocations: [{ invoiceId: manualInvoice, amountMinor: 20_000 }],
      idempotencyKey: crypto.randomUUID(),
    } satisfies PaymentCreateBody)
    paymentIds.push(viaForm.payment.payment.id)

    const direct = await db.transaction(async (tx) =>
      payablesService.postSupplierPaymentInTransaction(
        {
          branchId,
          supplierId,
          method: 'BANK',
          amountMinor: 20_000,
          paidAt,
          paymentDetailId: bankDetailId,
          reference: 'PARITY-1',
          note: 'parity check',
          idempotencyKey: crypto.randomUUID(),
          allocations: [{ invoiceId: directInvoice, amountMinor: 20_000 }],
        },
        {
          actorId: 'system:paystack',
          actorStaffId: null,
          ip: null,
          userAgent: null,
          requestId: null,
        },
        tx,
      ),
    )
    paymentIds.push(direct.id)

    const manual = viaForm.payment.payment
    expect(manual.id).not.toBe(direct.id)
    expect({
      supplierId: manual.supplierId,
      branchId: manual.branchId,
      method: manual.method,
      amountMinor: manual.amountMinor,
      reference: manual.reference,
      paidAt: manual.paidAt.toISOString(),
      paymentDetailId: manual.paymentDetailId,
      status: manual.status,
      note: manual.note,
    }).toEqual({
      supplierId: direct.supplierId,
      branchId: direct.branchId,
      method: direct.method,
      amountMinor: direct.amountMinor,
      reference: direct.reference,
      paidAt: direct.paidAt.toISOString(),
      paymentDetailId: direct.paymentDetailId,
      status: direct.status,
      note: direct.note,
    })
    // The only difference the plan allows.
    expect(manual.createdBy).toBe(actor.actorStaffId)
    expect(direct.createdBy).toBe('system:paystack')

    const allocations = await db
      .select({
        paymentId: supplierPaymentAllocation.paymentId,
        kind: supplierPaymentAllocation.kind,
        amountMinor: supplierPaymentAllocation.amountMinor,
      })
      .from(supplierPaymentAllocation)
      .where(inArray(supplierPaymentAllocation.paymentId, [manual.id, direct.id]))
    expect(allocations).toHaveLength(2)
    expect(allocations.map((row) => [row.kind, row.amountMinor])).toEqual([
      ['APPLY', 20_000],
      ['APPLY', 20_000],
    ])

    const invoices = await db
      .select({ status: supplierInvoice.status, amountPaidMinor: supplierInvoice.amountPaidMinor })
      .from(supplierInvoice)
      .where(inArray(supplierInvoice.id, [manualInvoice, directInvoice]))
    expect(invoices).toEqual([
      { status: 'PAID', amountPaidMinor: 20_000 },
      { status: 'PAID', amountPaidMinor: 20_000 },
    ])
    expect(supplierCode).toMatch(/^SUP/)
  })
})

describe('Paystack transfer client', () => {
  it('sends the documented recipient, transfer, finalize, verify and balance requests', async () => {
    const { PaystackPaymentProvider } = await import('../payments/payments.paystack.provider.ts')
    const requests: { url: string; method: string; body: unknown; authorization: string }[] = []

    const responses: Record<string, unknown> = {
      '/transferrecipient': {
        status: true,
        data: { recipient_code: 'RCP_test_123', type: 'ghipss', currency: 'GHS' },
      },
      '/transfer': {
        status: true,
        data: {
          id: 123456789012345,
          reference: 'sdt-00000000-0000-4000-8000-000000000000',
          status: 'pending',
          transfer_code: 'TRF_test_1',
          amount: 50_000,
          currency: 'GHS',
          fee_charged: 150,
        },
      },
      '/transfer/finalize_transfer': {
        status: true,
        data: {
          id: 123456789012345,
          reference: 'sdt-00000000-0000-4000-8000-000000000000',
          status: 'pending',
          transfer_code: 'TRF_test_1',
          amount: 50_000,
          currency: 'GHS',
        },
      },
      '/transfer/verify/sdt-00000000-0000-4000-8000-000000000000': {
        status: true,
        data: {
          id: 123456789012345,
          reference: 'sdt-00000000-0000-4000-8000-000000000000',
          status: 'success',
          transfer_code: 'TRF_test_1',
          amount: 50_000,
          currency: 'GHS',
          transferred_at: '2026-10-27T10:05:00.000Z',
          fee_charged: 150,
        },
      },
      '/balance': {
        status: true,
        data: [
          { currency: 'NGN', balance: 1 },
          { currency: 'GHS', balance: 500_000 },
        ],
      },
    }

    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input))
        requests.push({
          url: url.pathname,
          method: init?.method ?? 'GET',
          body: init?.body ? JSON.parse(String(init.body)) : null,
          authorization: String((init?.headers as Record<string, string>)?.Authorization ?? ''),
        })
        return new Response(JSON.stringify(responses[url.pathname]), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      })

    const info = vi.spyOn(logger, 'info')
    const warn = vi.spyOn(logger, 'warn')

    const provider = new PaystackPaymentProvider({
      secretKey: 'sk_test_super_secret_value',
      baseUrl: 'https://api.paystack.test',
    })

    const recipient = await provider.createTransferRecipient({
      type: 'ghipss',
      name: 'Kofi Supplies',
      accountNumber: '1234567890',
      bankCode: 'GCB',
      currency: 'GHS',
    })
    const initiated = await provider.initiateTransfer({
      reference: 'sdt-00000000-0000-4000-8000-000000000000',
      amountMinor: 50_000,
      recipientCode: recipient.recipientCode,
      reason: 'Supplier payment SUP-00001',
      currency: 'GHS',
    })
    const finalized = await provider.finalizeTransfer({
      transferCode: 'TRF_test_1',
      otp: '123456',
    })
    const verified = await provider.verifyTransfer('sdt-00000000-0000-4000-8000-000000000000')
    const balance = await provider.getBalance()

    expect(recipient.recipientCode).toBe('RCP_test_123')
    expect(initiated).toMatchObject({
      status: 'pending',
      transferCode: 'TRF_test_1',
      // A u64 stays a string; a JS number would round it.
      transferId: '123456789012345',
      amountMinor: 50_000,
      currency: 'GHS',
      feeMinor: 150,
    })
    expect(finalized.status).toBe('pending')
    expect(verified).toMatchObject({
      status: 'success',
      amountMinor: 50_000,
      transferredAt: '2026-10-27T10:05:00.000Z',
      feeMinor: 150,
    })
    expect(balance).toEqual({ currency: 'GHS', balanceMinor: 500_000 })

    const byPath = new Map(requests.map((request) => [request.url, request]))
    expect(byPath.get('/transferrecipient')?.body).toEqual({
      type: 'ghipss',
      name: 'Kofi Supplies',
      account_number: '1234567890',
      bank_code: 'GCB',
      currency: 'GHS',
    })
    expect(byPath.get('/transfer')?.body).toEqual({
      source: 'balance',
      amount: 50_000,
      currency: 'GHS',
      recipient: 'RCP_test_123',
      reason: 'Supplier payment SUP-00001',
      reference: 'sdt-00000000-0000-4000-8000-000000000000',
    })
    expect(byPath.get('/transfer/finalize_transfer')?.body).toEqual({
      transfer_code: 'TRF_test_1',
      otp: '123456',
    })
    expect(byPath.get('/transfer/verify/sdt-00000000-0000-4000-8000-000000000000')?.method).toBe(
      'GET',
    )
    expect(byPath.get('/balance')?.method).toBe('GET')

    for (const request of requests) {
      expect(request.authorization).toBe('Bearer sk_test_super_secret_value')
    }

    const logged = [...info.mock.calls, ...warn.mock.calls]
      .map((call) => JSON.stringify(call))
      .join('\n')
    expect(logged).not.toContain('sk_test_super_secret_value')
    expect(logged).not.toContain('RCP_test_123')
    expect(logged).not.toContain('1234567890')
    expect(logged).toContain('/transfer')

    expect(fetchMock).toHaveBeenCalled()
  })

  it('maps a mobile_money recipient and a wrong OTP without throwing', async () => {
    const { PaystackPaymentProvider } = await import('../payments/payments.paystack.provider.ts')
    const bodies: unknown[] = []

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(String(input))
        bodies.push(init?.body ? JSON.parse(String(init.body)) : null)
        if (url.pathname === '/transfer/finalize_transfer') {
          return new Response(
            JSON.stringify({ status: false, message: 'Transfer OTP is invalid' }),
            { status: 400, headers: { 'content-type': 'application/json' } },
          )
        }
        return new Response(
          JSON.stringify({ status: true, data: { recipient_code: 'RCP_momo' } }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      },
    )

    const provider = new PaystackPaymentProvider({
      secretKey: 'sk_test_super_secret_value',
      baseUrl: 'https://api.paystack.test',
    })

    await provider.createTransferRecipient({
      type: 'mobile_money',
      name: 'Ama Supplies',
      accountNumber: '+233241234567',
      bankCode: 'VOD',
      currency: 'GHS',
    })
    expect(bodies[0]).toEqual({
      type: 'mobile_money',
      name: 'Ama Supplies',
      account_number: '+233241234567',
      bank_code: 'VOD',
      currency: 'GHS',
    })

    const result = await provider.finalizeTransfer({ transferCode: 'TRF_2', otp: '999999' })
    expect(result.status).toBe('otp')
    expect(result.failureMessage).toBe('Transfer OTP is invalid')
  })
})
