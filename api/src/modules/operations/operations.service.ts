import { accraIsoDay } from '@sceptre/shared'
import { hasPermission, resolveBranchFilter } from '../../auth/scope.ts'
import type { SessionUser } from '../../http/factory.ts'
import { getApprovalSummary, listApprovals } from '../approvals/approvals.service.ts'
import { getCountAccuracy } from '../counts/counts.service.ts'
import { listOverLimit } from '../credit/credit.service.ts'
import { listLowStock } from '../inventory/inventory.service.ts'
import { countShiftsAwaitingReview } from '../pos/pos.service.ts'
import { listTransfers } from '../transfers/transfers.service.ts'
import { listWriteOffs } from '../writeoffs/writeoffs.service.ts'
import type { OperationsApprovalQueue, OperationsSummary } from './operations.types.ts'
import type { OperationsSummaryQuery } from './operations.validation.ts'

/**
 * The manager's branch view: one request, six queues, one branch decision.
 *
 * **Why it composes instead of querying.** Each number is the `total` of the list
 * endpoint the console links to, produced by that owner's own service with
 * `limit: 1`. Parity is therefore structural rather than maintained: there is no
 * second predicate to drift, and a change to `stock_write_off`'s "awaiting
 * decision" filter reaches the summary in the same commit. A repository here
 * would have needed seven tables and re-derived six rules (P9-D10, P12-D37).
 *
 * **Branch scope runs twice.** `requirePermission('approval.read')` on the route
 * decides *whether* the caller may read the view; `resolveBranchFilter` decides
 * *which* branch, and refuses a manager who asks for another one with a 403 —
 * exactly the shape P11-D17 locked in, so editing `?branchId=` cannot move the
 * scope.
 *
 * **A forbidden section is absent, not zero.** Zero is a statement about the
 * branch ("nothing is waiting"); absence is a statement about the caller. The
 * two must not be conflated (OWASP A01).
 *
 * **Cost.** Six counts over indexed predicates; no page of rows is materialised,
 * and nothing here loops over branches or rows. The one range read — count
 * accuracy — spans the current month through `stock_count_status_idx` and the
 * branch index, and its line aggregate touches only posted counts.
 */
export async function getOperationsSummary(
  user: SessionUser,
  query: OperationsSummaryQuery,
): Promise<OperationsSummary> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const summary: OperationsSummary = { branchId }

  const canReadApprovals = hasPermission(user, 'approval.read')
  const canReadInventory = hasPermission(user, 'inventory.read')
  const canReadCredit = hasPermission(user, 'credit.read')

  const tasks: Promise<void>[] = []

  if (canReadApprovals) {
    tasks.push(
      readApprovalQueue(user, branchId).then((queue) => {
        summary.approvals = queue
      }),
    )
    tasks.push(
      // Re-resolves the same scope through the service, which is the second,
      // independent check that a foreign branch can never be counted (P11-D17).
      countShiftsAwaitingReview(user, branchId).then(({ count }) => {
        summary.shiftVariances = { count }
      }),
    )
  }

  if (canReadInventory) {
    tasks.push(
      listTransfers(user, {
        branchId: branchId ?? undefined,
        status: 'REQUESTED',
        limit: 1,
        offset: 0,
      }).then(({ total }) => {
        summary.transferRequests = { count: total }
      }),
    )
    tasks.push(
      listWriteOffs(user, {
        branchId: branchId ?? undefined,
        status: 'PENDING_APPROVAL',
        limit: 1,
        offset: 0,
      }).then(({ total }) => {
        summary.writeOffs = { count: total }
      }),
    )
    // `inventory.listLowStock` accepts an unscoped read for an admin: every
    // branch's low stock, one row per branch, when no branch is chosen. A manager
    // still resolves to their own branch inside the service. The count is that
    // list's `total`, so it can never include a branch the caller may not see.
    tasks.push(
      listLowStock(user, {
        branchId: branchId ?? undefined,
        limit: 1,
        offset: 0,
      }).then(({ total }) => {
        summary.lowStock = { count: total }
      }),
    )
    const today = accraIsoDay()
    tasks.push(
      getCountAccuracy(user, {
        branchId: branchId ?? undefined,
        from: `${today.slice(0, 7)}-01`,
        to: today,
      }).then(({ accuracyBp }) => {
        summary.countAccuracyBp = accuracyBp
      }),
    )
  }

  if (canReadCredit) {
    tasks.push(
      listOverLimit(user, {
        branchId: branchId ?? undefined,
        limit: 1,
        offset: 0,
      }).then(({ total }) => {
        summary.overLimitCredit = { count: total }
      }),
    )
  }

  await Promise.all(tasks)
  return summary
}

/**
 * The approvals queue: the badge's per-type counts plus the oldest pending row.
 *
 * Two reads, both already owned by `approvals`: the grouped count behind
 * `GET /api/approvals/summary`, and the first row of the same inbox query the
 * list endpoint runs — so `oldest` is the row the manager sees at the top of the
 * list, not a separately sorted guess.
 */
async function readApprovalQueue(
  user: SessionUser,
  branchId: string | null,
): Promise<OperationsApprovalQueue> {
  const [counts, oldestPage] = await Promise.all([
    getApprovalSummary(user, branchId),
    listApprovals(user, { status: 'PENDING', sort: 'oldest', limit: 1, offset: 0 }),
  ])

  const oldest = oldestPage.approvals[0]
  const queue: OperationsApprovalQueue = { count: counts.pending, byType: counts.byType }
  queue.oldest = oldest
    ? {
        id: oldest.id,
        type: oldest.type,
        requestedAt: oldest.requestedAt.toISOString(),
        amountMinor: oldest.amountMinor,
      }
    : null
  return queue
}
