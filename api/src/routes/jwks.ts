import { factory } from '../http/factory.ts'
import { getJwks } from '../modules/sync/sync.jwt.ts'

export const jwksRoutes = factory.createApp()

/**
 * Public key set for the POS tokens.
 *
 * The PowerSync service fetches this URL (`client_auth.jwks_uri`) and uses it to
 * verify the short-lived PowerSync JWTs. It is public by design; only the public
 * half of the Ed25519 key is ever exposed.
 */
jwksRoutes.get('/.well-known/jwks.json', async (c) => {
  c.header('Cache-Control', 'public, max-age=300')
  return c.json(await getJwks())
})

/** Alias under the API prefix, for clients that only know `/api/...` routes. */
jwksRoutes.get('/api/.well-known/jwks.json', async (c) => {
  c.header('Cache-Control', 'public, max-age=300')
  return c.json(await getJwks())
})
