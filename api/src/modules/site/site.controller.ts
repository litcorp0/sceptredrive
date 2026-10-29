import type { Context } from 'hono'
import type { AppEnv } from '../../http/factory.ts'
import * as siteService from './site.service.ts'

/**
 * One public read. The cache header is deliberately short: an operator's edit
 * must be visible without a redeploy, while a shared cache may serve a slightly
 * stale copy. `stale-while-revalidate` keeps a traffic spike off the database
 * without making the page look frozen.
 */
export async function getSite(c: Context<AppEnv>) {
  const content = await siteService.getSiteContent()
  c.header('Cache-Control', 'public, max-age=60, stale-while-revalidate=300')
  return c.json({ content })
}
