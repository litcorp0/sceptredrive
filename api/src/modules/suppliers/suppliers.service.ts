import { type DbExecutor, db } from '@gikautos/db'
import { normalizeGhanaPhone } from '@gikautos/shared'
import { roleOf } from '../../auth/scope.ts'
import { actorLabel } from '../../http/audit-context.ts'
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { isUniqueViolation } from '../platform/db-errors.ts'
import { allocateFromSequence } from '../platform/settings.service.ts'
import { findProductById } from '../products/products.repository.ts'
import {
  clearDefaultPaymentDetails,
  clearPreferredSupplierProduct,
  countSuppliers,
  deleteSupplierProductRow,
  findPaymentDetailByAccount,
  findPaymentDetailById,
  findSupplierById,
  findSupplierByIdForUpdate,
  findSupplierProduct,
  findSupplierProductById,
  insertPaymentDetail,
  insertSupplier,
  insertSupplierProduct,
  listPaymentDetailsBySupplier,
  listSupplierProductsBySupplier,
  selectSupplierPage,
  setSupplierStatus,
  sumSupplierOwed,
  updateLastCost,
  updatePaymentDetailRow,
  updateSupplierProductRow,
  updateSupplierRow,
} from './suppliers.repository.ts'
import type {
  PaymentDetailCreateBody,
  PaymentDetailUpdateBody,
  SupplierCreateBody,
  SupplierDetail,
  SupplierListQuery,
  SupplierPaymentDetailRow,
  SupplierPaymentDetailView,
  SupplierProductCreateBody,
  SupplierProductUpdateBody,
  SupplierRow,
  SupplierSearchFilters,
  SupplierSearchResult,
  SupplierUpdateBody,
} from './suppliers.types.ts'

const INVALID_PHONE = 'Enter a valid Ghana phone number (e.g. 024 123 4567)'

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&')
}

/** Integer-only minor-unit formatting for operator-facing messages. */
function formatMinor(minor: number): string {
  const sign = minor < 0 ? '-' : ''
  const absolute = Math.abs(minor)
  const cedis = Math.trunc(absolute / 100)
  const pesewas = String(absolute % 100).padStart(2, '0')
  return `${sign}GHS ${cedis}.${pesewas}`
}

/** Bank/MoMo account numbers never appear raw outside the owning detail payload. */
export function maskAccountNumber(value: string | null): string | null {
  if (!value) return null
  return `•••• ${value.slice(-4)}`
}

function toPaymentDetailView(
  row: SupplierPaymentDetailRow,
  options: { raw: boolean },
): SupplierPaymentDetailView {
  return {
    id: row.id,
    method: row.method,
    label: row.label,
    accountName: row.accountName,
    accountNumber: options.raw ? row.accountNumber : null,
    accountNumberMasked: maskAccountNumber(row.accountNumber),
    bankName: row.bankName,
    bankCode: row.bankCode,
    momoNetwork: row.momoNetwork,
    phone: row.phone,
    isDefault: row.isDefault,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function normalizeOptionalPhone(input: string | null | undefined): string | null | undefined {
  if (input === undefined) return undefined
  if (input === null) return null
  const normalized = normalizeGhanaPhone(input)
  if (!normalized) throw new ValidationError(INVALID_PHONE)
  return normalized
}

/**
 * Searches suppliers by name fragment or code prefix. Archived rows are
 * hidden unless an admin asks for them.
 */
export async function listSuppliers(
  user: SessionUser,
  query: SupplierListQuery,
): Promise<SupplierSearchResult> {
  const isAdmin = roleOf(user) === 'ADMIN'
  if (!isAdmin && query.includeArchived) {
    throw new ForbiddenError('Only admins can include archived suppliers')
  }

  const filters: SupplierSearchFilters = {
    q: query.q ? escapeLikePattern(query.q) : null,
    includeArchived: query.includeArchived,
    limit: query.pageSize,
    offset: (query.page - 1) * query.pageSize,
  }

  const [suppliers, total] = await Promise.all([
    selectSupplierPage(filters),
    countSuppliers(filters),
  ])

  return { suppliers, total, page: query.page, pageSize: query.pageSize }
}

export async function createSupplier(
  actor: AuditActor,
  input: SupplierCreateBody,
): Promise<SupplierRow> {
  const phone = normalizeOptionalPhone(input.phone) ?? null

  return db.transaction(async (tx) => {
    const code = await allocateFromSequence('supplier.codeSequence', tx)
    const row = await insertSupplier(
      {
        code,
        name: input.name,
        contactName: input.contactName ?? null,
        phone,
        email: input.email ?? null,
        address: input.address ?? null,
        tin: input.tin ?? null,
        vatNumber: input.vatNumber ?? null,
        paymentTermDays: input.paymentTermDays ?? 0,
        notes: input.notes ?? null,
        createdBy: actorLabel(actor) ?? actor.actorId,
      },
      tx,
    )
    if (!row) throw new AppError(500, 'INTERNAL', 'Failed to create supplier')

    await writeAudit(
      {
        ...actor,
        action: 'supplier.created',
        entity: 'supplier',
        entityId: row.id,
        after: { code: row.code, name: row.name, phone: row.phone },
      },
      tx,
    )
    return row
  })
}

export async function updateSupplier(
  actor: AuditActor,
  id: string,
  input: SupplierUpdateBody,
): Promise<SupplierRow> {
  const existing = await findSupplierById(id)
  if (!existing) throw new NotFoundError('Supplier not found')

  const patch: Partial<typeof existing> = {}
  if (input.name !== undefined) patch.name = input.name
  if (input.contactName !== undefined) patch.contactName = input.contactName ?? null
  if (input.phone !== undefined) patch.phone = normalizeOptionalPhone(input.phone) ?? null
  if (input.email !== undefined) patch.email = input.email ?? null
  if (input.address !== undefined) patch.address = input.address ?? null
  if (input.tin !== undefined) patch.tin = input.tin ?? null
  if (input.vatNumber !== undefined) patch.vatNumber = input.vatNumber ?? null
  if (input.paymentTermDays !== undefined) patch.paymentTermDays = input.paymentTermDays
  if (input.notes !== undefined) patch.notes = input.notes ?? null

  return db.transaction(async (tx) => {
    const row = await updateSupplierRow(id, patch, tx)
    if (!row) throw new AppError(500, 'INTERNAL', 'Failed to update supplier')

    await writeAudit(
      {
        ...actor,
        action: 'supplier.updated',
        entity: 'supplier',
        entityId: id,
        before: {
          name: existing.name,
          phone: existing.phone,
          paymentTermDays: existing.paymentTermDays,
        },
        after: {
          name: row.name,
          phone: row.phone,
          paymentTermDays: row.paymentTermDays,
          changed: Object.keys(patch),
        },
      },
      tx,
    )
    return row
  })
}

/**
 * Cross-module seam for payables and inventory: a supplier must exist and be
 * active before it can take new documents.
 */
export async function requireSupplier(id: string, executor: DbExecutor = db): Promise<SupplierRow> {
  const row = await findSupplierById(id, executor)
  if (!row) throw new NotFoundError('Supplier not found')
  if (row.status !== 'ACTIVE') throw new ConflictError('The supplier is archived')
  return row
}

/**
 * Locks the supplier row for writes that create debts against it (D12:
 * invoice/payment creation serializes against archiving).
 */
export async function lockSupplier(id: string, executor: DbExecutor = db): Promise<SupplierRow> {
  const row = await findSupplierByIdForUpdate(id, executor)
  if (!row) throw new NotFoundError('Supplier not found')
  if (row.status !== 'ACTIVE') throw new ConflictError('The supplier is archived')
  return row
}

export async function getSupplierDetail(id: string): Promise<SupplierDetail> {
  const supplierRow = await findSupplierById(id)
  if (!supplierRow) throw new NotFoundError('Supplier not found')

  const [paymentDetails, products] = await Promise.all([
    listPaymentDetailsBySupplier(id),
    listSupplierProductsBySupplier(id),
  ])

  return {
    supplier: supplierRow,
    paymentDetails: paymentDetails.map((row) => toPaymentDetailView(row, { raw: true })),
    products,
  }
}

/**
 * Archives a supplier. Blocked while any invoice is outstanding or any
 * payment remainder sits on account (D9); amounts must be settled or voided.
 */
export async function archiveSupplier(
  actor: AuditActor,
  id: string,
  note?: string,
): Promise<SupplierRow> {
  return db.transaction(async (tx) => {
    const locked = await findSupplierByIdForUpdate(id, tx)
    if (!locked) throw new NotFoundError('Supplier not found')
    if (locked.status === 'ARCHIVED') return locked

    const owed = await sumSupplierOwed(id, tx)
    if (owed !== 0) {
      const detail =
        owed > 0
          ? `${formatMinor(owed)} is still owed`
          : `${formatMinor(-owed)} is held on account (unallocated payments)`
      throw new ConflictError(`Cannot archive: ${detail} — settle or void the open documents first`)
    }

    const row = await setSupplierStatus(id, 'ARCHIVED', tx)
    if (!row) throw new AppError(500, 'INTERNAL', 'Failed to archive supplier')

    await writeAudit(
      {
        ...actor,
        action: 'supplier.archived',
        entity: 'supplier',
        entityId: id,
        after: { status: row.status, note: note ?? null },
      },
      tx,
    )
    return row
  })
}

/** Returns an archived supplier to trading. Idempotent; audited on change. */
export async function reactivateSupplier(actor: AuditActor, id: string): Promise<SupplierRow> {
  return db.transaction(async (tx) => {
    const locked = await findSupplierByIdForUpdate(id, tx)
    if (!locked) throw new NotFoundError('Supplier not found')
    if (locked.status === 'ACTIVE') return locked

    const row = await setSupplierStatus(id, 'ACTIVE', tx)
    if (!row) throw new AppError(500, 'INTERNAL', 'Failed to reactivate supplier')

    await writeAudit(
      {
        ...actor,
        action: 'supplier.reactivated',
        entity: 'supplier',
        entityId: id,
        after: { status: row.status },
      },
      tx,
    )
    return row
  })
}

export async function addPaymentDetail(
  actor: AuditActor,
  supplierId: string,
  input: PaymentDetailCreateBody,
): Promise<SupplierPaymentDetailView> {
  await requireSupplier(supplierId)

  let accountNumber: string
  let phone: string | null = null
  if (input.method === 'MOMO') {
    const normalized = normalizeGhanaPhone(input.phone)
    if (!normalized) throw new ValidationError(INVALID_PHONE)
    accountNumber = normalized
    phone = normalized
  } else {
    accountNumber = input.accountNumber
  }

  const duplicate = await findPaymentDetailByAccount(supplierId, input.method, accountNumber)
  if (duplicate) throw new ConflictError('This payment account is already saved for the supplier')

  const existing = await listPaymentDetailsBySupplier(supplierId)
  const isFirstActive = !existing.some((detail) => detail.isActive)
  const isDefault = input.isDefault ?? isFirstActive

  try {
    return await db.transaction(async (tx) => {
      if (isDefault) await clearDefaultPaymentDetails(supplierId, tx)

      const row = await insertPaymentDetail(
        {
          supplierId,
          method: input.method,
          label: input.label ?? null,
          accountName: input.method === 'BANK' ? input.accountName : (input.accountName ?? null),
          accountNumber,
          bankName: input.method === 'BANK' ? input.bankName : null,
          bankCode: input.method === 'BANK' ? (input.bankCode ?? null) : null,
          momoNetwork: input.method === 'MOMO' ? input.momoNetwork : null,
          phone,
          isDefault,
          isActive: true,
          createdBy: actorLabel(actor) ?? actor.actorId,
        },
        tx,
      )
      if (!row) throw new AppError(500, 'INTERNAL', 'Failed to save the payment detail')

      await writeAudit(
        {
          ...actor,
          action: 'supplier_payment_detail.created',
          entity: 'supplier_payment_detail',
          entityId: row.id,
          after: {
            supplierId,
            method: row.method,
            isDefault: row.isDefault,
            accountNumberMasked: maskAccountNumber(row.accountNumber),
          },
        },
        tx,
      )
      return toPaymentDetailView(row, { raw: true })
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('This payment account is already saved for the supplier')
    }
    throw error
  }
}

export async function updatePaymentDetail(
  actor: AuditActor,
  supplierId: string,
  detailId: string,
  input: PaymentDetailUpdateBody,
): Promise<SupplierPaymentDetailView> {
  const existing = await findPaymentDetailById(detailId)
  if (!existing || existing.supplierId !== supplierId) {
    throw new NotFoundError('Payment detail not found')
  }

  const patch: Partial<typeof existing> = {}
  if (input.label !== undefined) patch.label = input.label ?? null
  if (input.accountName !== undefined) patch.accountName = input.accountName

  if (existing.method === 'BANK') {
    if (input.momoNetwork !== undefined || input.phone !== undefined) {
      throw new ValidationError('Mobile-money fields do not apply to bank details')
    }
    if (input.accountNumber !== undefined) {
      const clash = await findPaymentDetailByAccount(supplierId, 'BANK', input.accountNumber)
      if (clash && clash.id !== detailId) {
        throw new ConflictError('This payment account is already saved for the supplier')
      }
      patch.accountNumber = input.accountNumber
    }
    if (input.bankName !== undefined) patch.bankName = input.bankName ?? null
    if (input.bankCode !== undefined) patch.bankCode = input.bankCode ?? null
  } else {
    if (
      input.accountNumber !== undefined ||
      input.bankName !== undefined ||
      input.bankCode !== undefined
    ) {
      throw new ValidationError('Bank fields do not apply to mobile-money details')
    }
    if (input.momoNetwork !== undefined) patch.momoNetwork = input.momoNetwork
    if (input.phone !== undefined) {
      const normalized = normalizeGhanaPhone(input.phone)
      if (!normalized) throw new ValidationError(INVALID_PHONE)
      const clash = await findPaymentDetailByAccount(supplierId, 'MOMO', normalized)
      if (clash && clash.id !== detailId) {
        throw new ConflictError('This payment account is already saved for the supplier')
      }
      patch.phone = normalized
      patch.accountNumber = normalized
    }
  }

  if (input.isActive !== undefined) {
    patch.isActive = input.isActive
    if (!input.isActive && existing.isDefault) patch.isDefault = false
  }
  if (input.isDefault !== undefined) patch.isDefault = input.isDefault

  try {
    return await db.transaction(async (tx) => {
      if (patch.isDefault === true) await clearDefaultPaymentDetails(supplierId, tx)

      const row = await updatePaymentDetailRow(detailId, patch, tx)
      if (!row) throw new AppError(500, 'INTERNAL', 'Failed to update the payment detail')

      await writeAudit(
        {
          ...actor,
          action: 'supplier_payment_detail.updated',
          entity: 'supplier_payment_detail',
          entityId: detailId,
          before: {
            isDefault: existing.isDefault,
            isActive: existing.isActive,
            accountNumberMasked: maskAccountNumber(existing.accountNumber),
          },
          after: {
            isDefault: row.isDefault,
            isActive: row.isActive,
            accountNumberMasked: maskAccountNumber(row.accountNumber),
            changed: Object.keys(patch),
          },
        },
        tx,
      )
      return toPaymentDetailView(row, { raw: true })
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('This payment account is already saved for the supplier')
    }
    throw error
  }
}

export async function addSupplierProduct(
  actor: AuditActor,
  supplierId: string,
  input: SupplierProductCreateBody,
) {
  await requireSupplier(supplierId)

  const found = await findProductById(input.productId)
  if (!found) throw new NotFoundError('Product not found')
  if (!found.isActive) throw new ConflictError('The product is archived')

  const duplicate = await findSupplierProduct(supplierId, input.productId)
  if (duplicate) throw new ConflictError('This product is already linked to the supplier')

  try {
    return await db.transaction(async (tx) => {
      if (input.isPreferred) await clearPreferredSupplierProduct(input.productId, tx)

      const row = await insertSupplierProduct(
        {
          supplierId,
          productId: input.productId,
          supplierSku: input.supplierSku ?? null,
          leadTimeDays: input.leadTimeDays ?? null,
          isPreferred: input.isPreferred ?? false,
          createdBy: actorLabel(actor) ?? actor.actorId,
        },
        tx,
      )
      if (!row) throw new AppError(500, 'INTERNAL', 'Failed to link the product')

      await writeAudit(
        {
          ...actor,
          action: 'supplier_product.created',
          entity: 'supplier_product',
          entityId: row.id,
          after: {
            supplierId,
            productId: row.productId,
            supplierSku: row.supplierSku,
            isPreferred: row.isPreferred,
          },
        },
        tx,
      )
      return row
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('This product is already linked to the supplier')
    }
    throw error
  }
}

export async function updateSupplierProduct(
  actor: AuditActor,
  supplierId: string,
  mappingId: string,
  input: SupplierProductUpdateBody,
) {
  const existing = await findSupplierProductById(mappingId)
  if (!existing || existing.supplierId !== supplierId) {
    throw new NotFoundError('Supplier product link not found')
  }

  const patch: Partial<typeof existing> = {}
  if (input.supplierSku !== undefined) patch.supplierSku = input.supplierSku ?? null
  if (input.leadTimeDays !== undefined) patch.leadTimeDays = input.leadTimeDays ?? null
  if (input.isPreferred !== undefined) patch.isPreferred = input.isPreferred

  return db.transaction(async (tx) => {
    if (patch.isPreferred === true) {
      await clearPreferredSupplierProduct(existing.productId, tx)
    }

    const row = await updateSupplierProductRow(mappingId, patch, tx)
    if (!row) throw new AppError(500, 'INTERNAL', 'Failed to update the supplier product link')

    await writeAudit(
      {
        ...actor,
        action: 'supplier_product.updated',
        entity: 'supplier_product',
        entityId: mappingId,
        before: {
          supplierSku: existing.supplierSku,
          leadTimeDays: existing.leadTimeDays,
          isPreferred: existing.isPreferred,
        },
        after: {
          supplierSku: row.supplierSku,
          leadTimeDays: row.leadTimeDays,
          isPreferred: row.isPreferred,
          changed: Object.keys(patch),
        },
      },
      tx,
    )
    return row
  })
}

export async function removeSupplierProduct(
  actor: AuditActor,
  supplierId: string,
  mappingId: string,
): Promise<void> {
  const existing = await findSupplierProductById(mappingId)
  if (!existing || existing.supplierId !== supplierId) {
    throw new NotFoundError('Supplier product link not found')
  }

  await db.transaction(async (tx) => {
    await deleteSupplierProductRow(mappingId, tx)
    await writeAudit(
      {
        ...actor,
        action: 'supplier_product.deleted',
        entity: 'supplier_product',
        entityId: mappingId,
        after: { supplierId, productId: existing.productId, supplierSku: existing.supplierSku },
      },
      tx,
    )
  })
}

/**
 * Refreshes last-cost projections after an invoice is recorded. Called by the
 * payables service inside the invoice transaction; unmapped products no-op.
 */
export async function recordInvoiceCosts(
  supplierId: string,
  lines: readonly { productId: string | null; unitCostMinor: number }[],
  occurredAt: Date,
  executor: DbExecutor = db,
): Promise<void> {
  const costByProduct = new Map<string, number>()
  for (const line of lines) {
    if (line.productId) costByProduct.set(line.productId, line.unitCostMinor)
  }
  if (costByProduct.size === 0) return
  await updateLastCost(supplierId, [...costByProduct.keys()], costByProduct, occurredAt, executor)
}
