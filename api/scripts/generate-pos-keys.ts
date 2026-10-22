import { createPublicKey, generateKeyPairSync } from 'node:crypto'

/**
 * Generates the POS signing key for `.env`.
 *
 *   bun run --filter api keys:generate
 *
 * Prints a base64url PKCS8 Ed25519 private key plus the public JWKS that
 * PowerSync (or any verifier) will fetch from `/.well-known/jwks.json`.
 * The private key is a secret: never commit it.
 */
const { privateKey } = generateKeyPairSync('ed25519')
const pkcs8 = privateKey.export({ format: 'der', type: 'pkcs8' })
const privateKeyB64 = pkcs8.toString('base64url')

const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' })
const keyId = process.argv[2] ?? 'pos-v1'

console.log('# Add to .env (private key — keep secret):')
console.log(`POS_JWT_PRIVATE_KEY="${privateKeyB64}"`)
console.log(`POS_JWT_KEY_ID="${keyId}"`)
console.log('')
console.log('# Served as GET /.well-known/jwks.json (public):')
console.log(
  JSON.stringify({ keys: [{ ...publicJwk, kid: keyId, alg: 'EdDSA', use: 'sig' }] }, null, 2),
)
