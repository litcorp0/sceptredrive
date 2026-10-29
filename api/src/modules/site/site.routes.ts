import { factory } from '../../http/factory.ts'
import { rateLimit } from '../../http/rate-limit.ts'
import * as siteController from './site.controller.ts'

export const siteRoutes = factory.createApp()

/**
 * Public by design: the website has no session. The rate limit is the only
 * gate, and 120 requests a minute is far above a real page load while still
 * making the endpoint useless as a scraping or amplification target.
 */
siteRoutes.get(
  '/api/public/site',
  rateLimit({ windowMs: 60_000, max: 120, keyPrefix: 'public:site' }),
  (c) => siteController.getSite(c),
)
