import { type DbExecutor, type DbTransaction, db } from '@sceptre/db'
import {
  canApplyOrderAction,
  goodsValueMinor,
  orderFulfilment,
  type PurchaseOrderAction,
  type PurchaseOrderStatus,
  requiresApproval,
} from '@sceptre/shared'
import { assertBranchAccess, hasPermission, resolveBranchFilter, roleOf } from '../../auth/scope.ts'
import { actorLabel } from '../../http/audit-context.ts'
import {
  AppError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { findApprovalById, withdrawApprovalRow } from '../approvals/approvals.repository.ts'
import {
  registerDecisionHandler,
  requestApproval,
  resolveApprovalThreshold,
} from '../approvals/approvals.service.ts'
import { findReceiptByIdempotency } from '../inventory/inventory.repository.ts'
import * as inventoryService from '../inventory/inventory.service.ts'
import * as branchesService from '../org/branches.service.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { allocateDocumentNumber } from '../platform/sequences.service.ts'
import { findProductById } from '../products/products.repository.ts'
import * as suppliersService from '../suppliers/suppliers.service.ts'
import {
  countOrders,
  deleteOrderLines,
  findOrderByIdempotency,
  insertOrder,
  insertOrderLines,
  lockOrderForUpdate,
  selectMatchableOrders,
  selectOrderLines,
  selectOrderPage,
  selectOrderWithSupplier,
  selectReceivedByOrderLine,
  updateOrderRow,
} from './procurement.repository.ts'
import type {
  OrderActionBody,
  OrderCancelBody,
  OrderCreateBody,
  OrderDetail,
  OrderLineInput,
  OrderLineView,
  OrderList,
  OrderListQuery,
  OrderUpdateBody,
  ReceiveOrderBody,
} from './procurement.types.ts'

/** The line-level facts the invoice matcher needs; read-only and scoped. */
export interface OrderLineForMatch {
  id: string
  productId: string
  quantity: number
  unitCostMinor: number
  receivedQuantity: number
}

/**
 * The purchase order lifecycle.
 *
 * `DRAFT` is editable; every other state is a fact. Submit is where the
 * threshold is applied — below it a manager's order is approved automatically,
 * at or above it an admin decides, and an admin's own order is approved without
 * a second person because nobody may approve their own request (P11-D18).
 */

async function requireBranch(user: SessionUser, branchId: string) {
  const found = await branchesService.getBranch(user, branchId)
  if (!found.isActive) throw new ConflictError('The branch is inactive')
  return found
}

async function requireProducts(lines: readonly OrderLineInput[]) {
  for (const line of lines) {
    const found = await findProductById(line.productId)
    if (!found) throw new NotFoundError(`Product ${line.productId} not found`)
    if (!found.isActive) throw new ConflictError(`Product ${found.sku} is archived`)
  }
}

async function assertDraft(status: PurchaseOrderStatus): Promise<void> {
  if (status !== 'DRAFT') {
    throw new ConflictError('An approved order cannot be changed; cancel it and raise a new one')
  }
}

export async function createOrder(
  user: SessionUser,
  actor: AuditActor,
  input: OrderCreateBody,
): Promise<{ order: OrderDetail; replayed: boolean }> {
  assertBranchAccess(user, input.branchId)
  await requireBranch(user, input.branchId)
  await suppliersService.requireSupplier(input.supplierId)
  await requireProducts(input.lines)

  const existing = await findOrderByIdempotency(input.branchId, input.idempotencyKey)
  if (existing) {
    return { order: await getOrder(user, existing.id), replayed: true }
  }

  const created = await db.transaction(async (tx) => {
    const replay = await findOrderByIdempotency(input.branchId, input.idempotencyKey, tx)
    if (replay) return replay

    const { number } = await allocateDocumentNumber('purchase_order', input.branchId, tx)
    const order = await insertOrder(
      {
        number,
        branchId: input.branchId,
        supplierId: input.supplierId,
        expectedDate: input.expectedDate ?? null,
        note: input.note ?? null,
        requestedBy: actorLabel(actor) ?? 'unknown',
        idempotencyKey: input.idempotencyKey,
        createdBy: actor.actorId,
      },
      tx,
    )
    await insertOrderLines(order.id, input.lines, tx)

    const value = goodsValueMinor(input.lines)
    await writeAudit(
      {
        ...actor,
        action: 'purchase_order.created',
        entity: 'purchase_order',
        entityId: order.id,
        branchId: order.branchId,
        after: { number: order.number, lines: input.lines.length, goodsValueMinor: value },
      },
      tx,
    )
    return order
  })

  return { order: await getOrder(user, created.id), replayed: false }
}

export async function updateOrder(
  user: SessionUser,
  actor: AuditActor,
  orderId: string,
  input: OrderUpdateBody,
): Promise<OrderDetail> {
  await db.transaction(async (tx) => {
    const order = await lockOrderForUpdate(orderId, tx)
    if (!order) throw new NotFoundError('Purchase order not found')
    assertBranchAccess(user, order.branchId)
    await assertDraft(order.status)

    if (input.supplierId) await suppliersService.requireSupplier(input.supplierId)
    if (input.lines) await requireProducts(input.lines)

    const beforeLines = await selectOrderLines(order.id, tx)
    if (input.lines) {
      await deleteOrderLines(order.id, tx)
      await insertOrderLines(order.id, input.lines, tx)
    }

    const patch: Record<string, unknown> = {}
    if (input.supplierId) patch.supplierId = input.supplierId
    if (input.expectedDate !== undefined) patch.expectedDate = input.expectedDate ?? null
    if (input.note !== undefined) patch.note = input.note ?? null
    if (Object.keys(patch).length > 0) await updateOrderRow(order.id, patch, tx)

    await writeAudit(
      {
        ...actor,
        action: 'purchase_order.updated',
        entity: 'purchase_order',
        entityId: order.id,
        branchId: order.branchId,
        before: { lines: beforeLines.length },
        after: { lines: input.lines?.length ?? beforeLines.length },
      },
      tx,
    )
  })

  return getOrder(user, orderId)
}

export async function submitOrder(
  user: SessionUser,
  actor: AuditActor,
  orderId: string,
): Promise<OrderDetail> {
  await db.transaction(async (tx) => {
    const order = await lockOrderForUpdate(orderId, tx)
    if (!order) throw new NotFoundError('Purchase order not found')
    assertBranchAccess(user, order.branchId)
    if (!canApplyOrderAction(order.status, 'submit')) {
      throw new ConflictError(`A ${order.status} order cannot be submitted`)
    }

    const lines = await selectOrderLines(order.id, tx)
    const value = goodsValueMinor(lines)
    if (value <= 0) throw new AppError(400, 'VALIDATION_ERROR', 'An order needs a value above zero')

    const { thresholdMinor, source } = await resolveApprovalThreshold(order.branchId, tx)
    const isAdmin = roleOf(user) === 'ADMIN'
    const needsDecision = !isAdmin && requiresApproval(value, thresholdMinor)

    if (needsDecision) {
      const approvalRow = await requestApproval(
        actor,
        {
          type: 'PURCHASE_ORDER',
          entityId: order.id,
          branchId: order.branchId,
          amountMinor: value,
          note: order.note,
        },
        tx,
      )
      await updateOrderRow(
        order.id,
        {
          status: 'PENDING_APPROVAL',
          approvalId: approvalRow.id,
          submittedAt: new Date(),
        },
        tx,
      )
      await writeAudit(
        {
          ...actor,
          action: 'purchase_order.submitted',
          entity: 'purchase_order',
          entityId: order.id,
          branchId: order.branchId,
          after: { goodsValueMinor: value, thresholdMinor, approvalId: approvalRow.id },
        },
        tx,
      )
      return
    }

    await updateOrderRow(
      order.id,
      { status: 'APPROVED', submittedAt: new Date(), approvedAt: new Date() },
      tx,
    )
    await writeAudit(
      {
        ...actor,
        action: 'purchase_order.auto_approved',
        entity: 'purchase_order',
        entityId: order.id,
        branchId: order.branchId,
        after: {
          goodsValueMinor: value,
          thresholdMinor,
          thresholdSource: source,
          reason: isAdmin ? 'ADMIN_REQUEST' : 'THRESHOLD',
        },
      },
      tx,
    )
  })

  return getOrder(user, orderId)
}

export async function sendOrder(
  user: SessionUser,
  actor: AuditActor,
  orderId: string,
): Promise<OrderDetail> {
  await db.transaction(async (tx) => {
    const order = await lockOrderForUpdate(orderId, tx)
    if (!order) throw new NotFoundError('Purchase order not found')
    assertBranchAccess(user, order.branchId)

    // Sending twice re-opens the print sheet without moving the timestamp: the
    // actual lead time is measured from the first send.
    if (order.status === 'SENT') return
    if (!canApplyOrderAction(order.status, 'send')) {
      throw new ConflictError(`A ${order.status} order cannot be sent`)
    }

    await updateOrderRow(
      order.id,
      { status: 'SENT', sentAt: new Date(), sentBy: actor.actorId },
      tx,
    )
    await writeAudit(
      {
        ...actor,
        action: 'purchase_order.sent',
        entity: 'purchase_order',
        entityId: order.id,
        branchId: order.branchId,
        before: { status: order.status },
        after: { status: 'SENT' },
      },
      tx,
    )
  })

  return getOrder(user, orderId)
}

export async function cancelOrder(
  user: SessionUser,
  actor: AuditActor,
  orderId: string,
  input: OrderCancelBody,
): Promise<OrderDetail> {
  await db.transaction(async (tx) => {
    const order = await lockOrderForUpdate(orderId, tx)
    if (!order) throw new NotFoundError('Purchase order not found')
    assertBranchAccess(user, order.branchId)

    if (!canApplyOrderAction(order.status, 'cancel')) {
      throw new ConflictError(`A ${order.status} order cannot be cancelled`)
    }

    // Goods that arrived are a fact; the order can be closed short instead.
    const received = await selectReceivedByOrderLine(order.id, tx)
    const totalReceived = [...received.values()].reduce((sum, value) => sum + value, 0)
    if (totalReceived > 0) {
      throw new ConflictError('Goods have been received against this order; close it instead')
    }

    if (order.approvalId) {
      await withdrawPendingApproval(order.approvalId, tx)
    }

    await updateOrderRow(
      order.id,
      {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: actor.actorId,
        cancelReason: input.reason,
      },
      tx,
    )
    await writeAudit(
      {
        ...actor,
        action: 'purchase_order.cancelled',
        entity: 'purchase_order',
        entityId: order.id,
        branchId: order.branchId,
        before: { status: order.status },
        after: { status: 'CANCELLED', reason: input.reason },
      },
      tx,
    )
  })

  return getOrder(user, orderId)
}

export async function closeOrder(
  user: SessionUser,
  actor: AuditActor,
  orderId: string,
  input: OrderActionBody,
): Promise<OrderDetail> {
  await db.transaction(async (tx) => {
    const order = await lockOrderForUpdate(orderId, tx)
    if (!order) throw new NotFoundError('Purchase order not found')
    assertBranchAccess(user, order.branchId)

    if (!canApplyOrderAction(order.status, 'close')) {
      throw new ConflictError(`A ${order.status} order cannot be closed`)
    }

    const lines = await selectOrderLines(order.id, tx)
    const received = await selectReceivedByOrderLine(order.id, tx)
    const outstanding = lines.map((line) => ({
      productId: line.productId,
      outstanding: Math.max(line.quantity - (received.get(line.id) ?? 0), 0),
    }))

    await updateOrderRow(
      order.id,
      {
        status: 'CLOSED',
        closedAt: new Date(),
        closedBy: actor.actorId,
        closeNote: input.note ?? null,
      },
      tx,
    )
    await writeAudit(
      {
        ...actor,
        action: 'purchase_order.closed',
        entity: 'purchase_order',
        entityId: order.id,
        branchId: order.branchId,
        before: { status: order.status },
        after: { status: 'CLOSED', outstanding, note: input.note ?? null },
      },
      tx,
    )
  })

  return getOrder(user, orderId)
}

export async function listOrders(user: SessionUser, query: OrderListQuery): Promise<OrderList> {
  const branchId = resolveBranchFilter(user, query.branchId)
  const filters = { ...query, branchId }
  const [rows, total] = await Promise.all([selectOrderPage(filters), countOrders(filters)])

  return {
    branchId,
    total,
    orders: rows.map((row) => ({
      id: row.order.id,
      number: row.order.number,
      status: row.order.status,
      supplierId: row.order.supplierId,
      supplierName: row.supplierName,
      branchId: row.order.branchId,
      branchCode: row.branchCode,
      expectedDate: row.order.expectedDate,
      goodsValueMinor: row.goodsValueMinor,
      receivedQuantity: row.receivedQuantity,
      orderedQuantity: row.orderedQuantity,
      createdAt: row.order.createdAt,
    })),
  }
}

export async function getOrder(user: SessionUser, orderId: string): Promise<OrderDetail> {
  const found = await selectOrderWithSupplier(orderId)
  if (!found) throw new NotFoundError('Purchase order not found')
  assertBranchAccess(user, found.order.branchId)

  const [lines, received, threshold, approvalRow] = await Promise.all([
    selectOrderLines(orderId),
    selectReceivedByOrderLine(orderId),
    resolveApprovalThreshold(found.order.branchId),
    found.order.approvalId ? findApprovalById(found.order.approvalId) : Promise.resolve(null),
  ])

  const lineViews: OrderLineView[] = lines.map((line) => {
    const receivedQuantity = received.get(line.id) ?? 0
    return {
      ...line,
      lineTotalMinor: line.quantity * line.unitCostMinor,
      receivedQuantity,
      outstandingQuantity: Math.max(line.quantity - receivedQuantity, 0),
    }
  })

  const totalReceived = lineViews.reduce((sum, line) => sum + line.receivedQuantity, 0)
  const status = found.order.status
  const canWrite = hasPermission(user, 'procurement.create')

  const canApply: Record<PurchaseOrderAction, boolean> = {
    submit: canWrite && canApplyOrderAction(status, 'submit'),
    send: canWrite && canApplyOrderAction(status, 'send'),
    cancel:
      canWrite &&
      canApplyOrderAction(status, 'cancel') &&
      (status !== 'SENT' || totalReceived === 0),
    close: canWrite && canApplyOrderAction(status, 'close'),
    receive: hasPermission(user, 'procurement.receive') && canApplyOrderAction(status, 'receive'),
  }

  return {
    order: { ...found.order, supplierName: found.supplierName, supplierCode: found.supplierCode },
    lines: lineViews,
    goodsValueMinor: goodsValueMinor(lineViews),
    threshold: { valueMinor: threshold.thresholdMinor, source: threshold.source },
    approval: approvalRow
      ? {
          id: approvalRow.id,
          status: approvalRow.status,
          requestedBy: approvalRow.requestedBy,
          decidedBy: approvalRow.decidedBy ?? null,
          decidedAt: approvalRow.decidedAt ?? null,
          decisionReasonCode: approvalRow.decisionReasonCode ?? null,
        }
      : null,
    canApply,
  }
}

/**
 * Receives goods against an order (PROC-03, P11-D4/P11-D19).
 *
 * The stock write goes through the existing receipt path — `createReceipt` with
 * this transaction as its executor — so there is still exactly one way stock
 * enters the system, average cost is still computed once, and the catalogue cost
 * still follows the receipt (P11-D13).
 *
 * A short delivery leaves the order open. An over-delivery needs a reason and is
 * recorded, never clamped. A replay of the same idempotency key returns the
 * original receipt.
 */
export async function receiveOrder(
  user: SessionUser,
  actor: AuditActor,
  orderId: string,
  input: ReceiveOrderBody,
): Promise<{
  receipt: Awaited<ReturnType<typeof inventoryService.getReceipt>>
  order: OrderDetail
  replayed: boolean
}> {
  const result = await db.transaction(async (tx) => {
    const order = await lockOrderForUpdate(orderId, tx)
    if (!order) throw new NotFoundError('Purchase order not found')
    assertBranchAccess(user, order.branchId)

    // Replay first: a retried request must return the original receipt even
    // though the order has since moved on to RECEIVED.
    const replay = await findReceiptByIdempotency(order.branchId, input.idempotencyKey, tx)
    if (replay) return { receiptId: replay.id, receiptNumber: null, replayed: true }

    if (!canApplyOrderAction(order.status, 'receive')) {
      throw new ConflictError(`A ${order.status} order cannot be received`)
    }

    const lines = await selectOrderLines(order.id, tx)
    const lineById = new Map(lines.map((line) => [line.id, line]))
    const receivedBefore = await selectReceivedByOrderLine(order.id, tx)

    const posting = input.lines.map((inputLine) => {
      const orderLine = lineById.get(inputLine.purchaseOrderLineId)
      if (!orderLine) {
        throw new AppError(400, 'VALIDATION_ERROR', 'That line is not on this order')
      }
      const alreadyReceived = receivedBefore.get(orderLine.id) ?? 0
      const outstanding = Math.max(orderLine.quantity - alreadyReceived, 0)

      if (inputLine.quantity > outstanding && !inputLine.overReceiptReason) {
        throw new AppError(
          400,
          'VALIDATION_ERROR',
          `An over-delivery needs a reason: ordered ${orderLine.quantity}, received ${alreadyReceived}, outstanding ${outstanding}`,
        )
      }

      return { ...inputLine, productId: orderLine.productId, alreadyReceived, outstanding }
    })

    const receipt = await inventoryService.createReceipt(
      user,
      actor,
      {
        branchId: order.branchId,
        supplierId: order.supplierId,
        supplierInvoiceNumber: input.supplierInvoiceNumber,
        note: input.note,
        purchaseOrderId: order.id,
        idempotencyKey: input.idempotencyKey,
        lines: posting.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          unitCostMinor: line.unitCostMinor,
          purchaseOrderLineId: line.purchaseOrderLineId,
          overReceiptReason: line.overReceiptReason,
          overReceiptNote: line.overReceiptNote,
        })),
      },
      { executor: tx },
    )

    // PROC-09: the first delivery of a part creates its supplier link and cost.
    const occurredAt = new Date()
    for (const line of posting) {
      await suppliersService.ensureSupplierProductLink(
        actor,
        {
          supplierId: order.supplierId,
          productId: line.productId,
          unitCostMinor: line.unitCostMinor,
          occurredAt,
          receiptId: receipt.id,
        },
        tx,
      )
    }

    const receivedAfter = new Map(receivedBefore)
    for (const line of posting) {
      receivedAfter.set(
        line.purchaseOrderLineId,
        (receivedAfter.get(line.purchaseOrderLineId) ?? 0) + line.quantity,
      )
    }
    const fulfilment = orderFulfilment(
      lines.map((line) => ({
        ordered: line.quantity,
        received: receivedAfter.get(line.id) ?? 0,
      })),
    )
    const status: PurchaseOrderStatus = fulfilment.allReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED'
    await updateOrderRow(order.id, { status }, tx)

    await writeAudit(
      {
        ...actor,
        action: 'purchase_order.received',
        entity: 'purchase_order',
        entityId: order.id,
        branchId: order.branchId,
        after: {
          receiptId: receipt.id,
          receiptNumber: receipt.number,
          status,
          lines: posting.map((line) => ({
            purchaseOrderLineId: line.purchaseOrderLineId,
            productId: line.productId,
            receivedBefore: line.alreadyReceived,
            receivedNow: line.quantity,
            receivedAfter: receivedAfter.get(line.purchaseOrderLineId) ?? 0,
            overReceiptReason: line.overReceiptReason ?? null,
          })),
        },
      },
      tx,
    )

    return { receiptId: receipt.id, receiptNumber: receipt.number, replayed: false }
  })

  return {
    receipt: await inventoryService.getReceipt(user, result.receiptId),
    order: await getOrder(user, orderId),
    replayed: result.replayed,
  }
}

/** Plan 04's half of the decision registry. Plans 05–07 extend this file. */
registerDecisionHandler('PURCHASE_ORDER', async (tx, approval, actor, decision, input) => {
  if (!approval.entityId) {
    throw new AppError(500, 'INTERNAL', 'A purchase-order approval has no order')
  }

  const order = await lockOrderForUpdate(approval.entityId, tx)
  if (!order) throw new NotFoundError('Purchase order not found')

  if (order.status !== 'PENDING_APPROVAL') {
    throw new ConflictError('This order has already moved')
  }

  const status: PurchaseOrderStatus = decision === 'APPROVED' ? 'APPROVED' : 'REJECTED'
  await updateOrderRow(
    order.id,
    {
      status,
      approvedAt: decision === 'APPROVED' ? new Date() : null,
      rejectedAt: decision === 'REJECTED' ? new Date() : null,
    },
    tx,
  )

  await writeAudit(
    {
      ...actor,
      action: `purchase_order.${status.toLowerCase()}`,
      entity: 'purchase_order',
      entityId: order.id,
      branchId: order.branchId,
      before: { status: order.status },
      after: { status, approvalId: approval.id, reasonCode: input.reasonCode ?? null },
    },
    tx,
  )

  return undefined
})

async function withdrawPendingApproval(approvalId: string, tx: DbTransaction): Promise<void> {
  const approvalRow = await findApprovalById(approvalId, tx)
  if (approvalRow?.status === 'PENDING') {
    // The order takes the approval with it; the audit entry on the order records
    // why, so this row is closed without a second decision trail.
    await withdrawApprovalRow(approvalRow.id, tx)
  }
}

/**
 * Read seam for invoice matching (Plan 06). Payables calls this, never a
 * repository, so the order's rules stay in one module and the dependency runs
 * one way: `payables → procurement`.
 */
export async function getOrderLinesForMatch(
  orderId: string,
  scope: { branchId: string; supplierId: string },
  executor: DbExecutor,
): Promise<{ orderNumber: string; status: PurchaseOrderStatus; lines: OrderLineForMatch[] }> {
  const found = await selectOrderWithSupplier(orderId, executor)
  if (!found) throw new NotFoundError('Purchase order not found')
  if (found.order.branchId !== scope.branchId) {
    throw new ForbiddenError('This order belongs to another branch')
  }
  if (found.order.supplierId !== scope.supplierId) {
    throw new ValidationError('This order belongs to another supplier')
  }
  if (found.order.status === 'CANCELLED' || found.order.status === 'REJECTED') {
    throw new ConflictError(`A ${found.order.status.toLowerCase()} order cannot be invoiced`)
  }

  const [lines, received] = await Promise.all([
    selectOrderLines(orderId, executor),
    selectReceivedByOrderLine(orderId, executor),
  ])

  return {
    orderNumber: found.order.number,
    status: found.order.status,
    lines: lines.map((line) => ({
      id: line.id,
      productId: line.productId,
      quantity: line.quantity,
      unitCostMinor: line.unitCostMinor,
      receivedQuantity: received.get(line.id) ?? 0,
    })),
  }
}

/** The invoice form's picker: orders for one supplier that can be matched. */
export async function listMatchableOrders(
  user: SessionUser,
  query: { branchId?: string | null; supplierId: string },
): Promise<{ orders: Awaited<ReturnType<typeof selectMatchableOrders>> }> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  if (!branchId) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Choose a branch to match invoices against')
  }
  return { orders: await selectMatchableOrders(branchId, query.supplierId) }
}
