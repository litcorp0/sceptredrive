import type { Context } from 'hono'
import { currentUser } from '../../http/authorize.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as analyticsService from './analytics.service.ts'
import type { AnalyticsQuery } from './analytics.types.ts'

/**
 * Analytics controllers are deliberately only plumbing: the validated query and the signed
 * in user go in, the service's read model comes out. No aggregation, no branch logic, no
 * formatting happens here.
 */
export async function getOverview(c: Context<AppEnv>, query: AnalyticsQuery) {
  const user = currentUser(c)
  return c.json(await analyticsService.getOverview({ user, query }))
}

export async function getSales(
  c: Context<AppEnv>,
  query: Parameters<typeof analyticsService.getSales>[0]['query'],
) {
  const user = currentUser(c)
  return c.json(await analyticsService.getSales({ user, query }))
}

export async function getProducts(
  c: Context<AppEnv>,
  query: Parameters<typeof analyticsService.getProducts>[0]['query'],
) {
  const user = currentUser(c)
  return c.json(await analyticsService.getProducts({ user, query }))
}

export async function getTax(c: Context<AppEnv>, query: AnalyticsQuery) {
  const user = currentUser(c)
  return c.json(await analyticsService.getTax({ user, query }))
}

export async function getInventory(c: Context<AppEnv>, query: AnalyticsQuery) {
  const user = currentUser(c)
  return c.json(await analyticsService.getInventory({ user, query }))
}

export async function getCredit(c: Context<AppEnv>, query: AnalyticsQuery) {
  const user = currentUser(c)
  return c.json(await analyticsService.getCredit({ user, query }))
}

export async function getLoyalty(c: Context<AppEnv>, query: AnalyticsQuery) {
  const user = currentUser(c)
  return c.json(await analyticsService.getLoyalty({ user, query }))
}

export async function getPayables(c: Context<AppEnv>, query: AnalyticsQuery) {
  const user = currentUser(c)
  return c.json(await analyticsService.getPayables({ user, query }))
}

function sendCsv(c: Context<AppEnv>, result: { filename: string; csv: string }) {
  c.header('content-type', 'text/csv; charset=utf-8')
  c.header('content-disposition', `attachment; filename="${result.filename}"`)
  c.header('cache-control', 'no-store, private')
  return c.body(result.csv)
}

export async function exportSales(c: Context<AppEnv>, query: AnalyticsQuery) {
  const user = currentUser(c)
  return sendCsv(c, await analyticsService.exportSales({ user, query }))
}

export async function exportProducts(c: Context<AppEnv>, query: AnalyticsQuery) {
  const user = currentUser(c)
  return sendCsv(c, await analyticsService.exportProducts({ user, query }))
}

export async function exportTax(c: Context<AppEnv>, query: AnalyticsQuery) {
  const user = currentUser(c)
  return sendCsv(c, await analyticsService.exportTax({ user, query }))
}

export async function exportInventory(c: Context<AppEnv>, query: AnalyticsQuery) {
  const user = currentUser(c)
  return sendCsv(c, await analyticsService.exportInventory({ user, query }))
}

export async function exportCredit(c: Context<AppEnv>, query: AnalyticsQuery) {
  const user = currentUser(c)
  return sendCsv(c, await analyticsService.exportCredit({ user, query }))
}

export async function exportLoyalty(c: Context<AppEnv>, query: AnalyticsQuery) {
  const user = currentUser(c)
  return sendCsv(c, await analyticsService.exportLoyalty({ user, query }))
}

export async function exportPayables(c: Context<AppEnv>, query: AnalyticsQuery) {
  const user = currentUser(c)
  return sendCsv(c, await analyticsService.exportPayables({ user, query }))
}
