import type { Context } from 'hono'
import { actorFromContext } from '../../http/audit-context.ts'
import { currentUser } from '../../http/authorize.ts'
import { sendCsv } from '../../http/csv.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as inventoryReport from './inventory.report.ts'
import * as inventoryService from './inventory.service.ts'
import type {
  AdjustmentCreateInput,
  MovementListQuery,
  ReceiptCreateInput,
  ReceiptListQuery,
  StockListQuery,
  StockReportQuery,
  ThresholdInput,
} from './inventory.types.ts'

export async function createReceipt(c: Context<AppEnv>, input: ReceiptCreateInput) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const receipt = await inventoryService.createReceipt(user, actor, input)
  return c.json({ receipt }, 201)
}

export async function listReceipts(c: Context<AppEnv>, query: ReceiptListQuery) {
  const user = currentUser(c)
  const result = await inventoryService.listReceipts(user, query)
  return c.json(result)
}

export async function getReceipt(c: Context<AppEnv>, id: string) {
  const user = currentUser(c)
  const receipt = await inventoryService.getReceipt(user, id)
  return c.json({ receipt })
}

export async function createAdjustment(c: Context<AppEnv>, input: AdjustmentCreateInput) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const result = await inventoryService.createAdjustment(user, actor, input)
  return c.json(result, 201)
}

export async function listMovements(c: Context<AppEnv>, query: MovementListQuery) {
  const user = currentUser(c)
  const result = await inventoryService.listMovements(user, query)
  return c.json(result)
}

export async function listStock(c: Context<AppEnv>, query: StockListQuery) {
  const user = currentUser(c)
  const result = await inventoryService.listStock(user, query)
  return c.json(result)
}

export async function listLowStock(c: Context<AppEnv>, query: StockListQuery) {
  const user = currentUser(c)
  const result = await inventoryService.listLowStock(user, query)
  return c.json(result)
}

export async function getStockReport(c: Context<AppEnv>, query: StockReportQuery) {
  const user = currentUser(c)
  return c.json(await inventoryReport.getStockReport(user, query))
}

export async function exportStockReport(c: Context<AppEnv>, query: StockReportQuery) {
  const user = currentUser(c)
  return sendCsv(c, await inventoryReport.exportStockReport(user, query))
}

export async function getStockDetail(c: Context<AppEnv>, productId: string, branchId?: string) {
  const user = currentUser(c)
  const stock = await inventoryService.getStockDetail(user, productId, branchId)
  return c.json({ stock })
}

export async function listThresholds(c: Context<AppEnv>, branchId?: string) {
  const user = currentUser(c)
  const result = await inventoryService.listThresholds(user, branchId)
  return c.json(result)
}

export async function setThreshold(c: Context<AppEnv>, input: ThresholdInput) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  const threshold = await inventoryService.setThreshold(user, actor, input)
  return c.json({ threshold })
}

export async function removeThreshold(c: Context<AppEnv>, productId: string, branchId?: string) {
  const user = currentUser(c)
  const actor = actorFromContext(c)
  await inventoryService.removeThreshold(user, actor, productId, branchId)
  return c.json({ ok: true })
}
