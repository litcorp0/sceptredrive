import type { Context } from 'hono'
import { resolveBranchFilter } from '../../auth/scope.ts'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as oversightService from './pos.oversight.service.ts'
import { reconcilePos } from './pos.reconciliation.ts'
import type {
  OversightRefundsQuery,
  OversightSalesQuery,
  OversightShiftsQuery,
  ReconciliationQuery,
} from './pos.validation.ts'

/**
 * Read-only reconciliation for the console. Admins may ask for one branch or
 * all branches; managers are always pinned to their own branch. Divergences are
 * returned, never corrected.
 */
export async function reconciliation(c: Context<AppEnv>, query: ReconciliationQuery) {
  const user = currentUser(c)
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const result = await reconcilePos(branchId)
  return c.json(result)
}

// --- Oversight reads (Phase 14, Plan 03) ------------------------------------
//
// Each handler is two lines: validated input in, service out. Scope, masking and
// document assembly belong to the service, never to the HTTP layer.

export async function listSales(c: Context<AppEnv>, query: OversightSalesQuery) {
  const result = await oversightService.listSales(currentUser(c), query)
  return c.json(result)
}

export async function getSale(c: Context<AppEnv>, id: string) {
  const result = await oversightService.getSale(currentUser(c), id)
  return c.json(result)
}

export async function getReceiptCopy(c: Context<AppEnv>, id: string) {
  const result = await oversightService.getReceiptCopy(currentUser(c), id)
  return c.json(result)
}

export async function listRefunds(c: Context<AppEnv>, query: OversightRefundsQuery) {
  const result = await oversightService.listRefunds(currentUser(c), query)
  return c.json(result)
}

export async function getRefund(c: Context<AppEnv>, id: string) {
  const result = await oversightService.getRefund(currentUser(c), id)
  return c.json(result)
}

export async function listShifts(c: Context<AppEnv>, query: OversightShiftsQuery) {
  const result = await oversightService.listShifts(currentUser(c), query)
  return c.json(result)
}
