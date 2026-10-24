import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from 'node:crypto'
import { exportJWK, type JWK, jwtVerify, SignJWT } from 'jose'
import { env } from '../../config/env.ts'
import { AppError } from '../../http/errors.ts'
import { logger } from '../../logger.ts'

/**
 * Two token families, one Ed25519 key:
 *
 * 1. **Device JWT** (`aud = sceptre-pos`, `typ = device`) authenticates POS API
 *    calls: short-lived, derived from the long-lived device token.
 * 2. **PowerSync JWT** (`aud = POWERSYNC_AUDIENCE`) is handed to the PowerSync
 *    service, which validates it against our JWKS and reads `branch_id` /
 *    `terminal_id` from it. Those claims are what scope the sync streams.
 *
 * The private key never leaves the API process. PowerSync only ever sees the
 * public JWK from `/.well-known/jwks.json`.
 */

export const DEVICE_TOKEN_AUDIENCE = 'sceptre-pos'
export const DEVICE_TOKEN_TYPE = 'device'

export interface DeviceTokenClaims {
  /** Device row id. */
  sub: string
  device_id: string
  terminal_id: string
  branch_id: string
}

export interface SigningKey {
  keyId: string
  privateKey: KeyObject
  publicKey: KeyObject
  publicJwk: JWK
  /** True when the key was generated at boot because none was configured. */
  ephemeral: boolean
}

let cachedKey: SigningKey | null = null

function decodeBase64Url(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

async function loadSigningKey(): Promise<SigningKey> {
  const keyId = env.POS_JWT_KEY_ID

  if (env.POS_JWT_PRIVATE_KEY) {
    const der = decodeBase64Url(env.POS_JWT_PRIVATE_KEY)
    const privateKey = createPrivateKey({ key: der, format: 'der', type: 'pkcs8' })
    const publicKey = createPublicKey(privateKey)
    return { keyId, privateKey, publicKey, publicJwk: await exportJWK(publicKey), ephemeral: false }
  }

  if (env.NODE_ENV === 'production') {
    // `env.ts` already refuses to boot in production without a key; this is the
    // belt-and-braces check for callers that bypass the module-level guard.
    throw new Error('POS_JWT_PRIVATE_KEY is required in production')
  }

  const { privateKey, publicKey } = generateKeyPairSync('ed25519')

  logger.warn(
    'POS_JWT_PRIVATE_KEY is unset: using an ephemeral Ed25519 key. Tokens become invalid after a restart and must never be used outside development.',
  )

  return { keyId, privateKey, publicKey, publicJwk: await exportJWK(publicKey), ephemeral: true }
}

export async function getSigningKey(): Promise<SigningKey> {
  if (!cachedKey) {
    cachedKey = await loadSigningKey()
  }
  return cachedKey
}

/** Test seam: forget the cached key so the next call re-reads configuration. */
export function resetSigningKeyForTests(): void {
  cachedKey = null
}

export async function getJwks(): Promise<{ keys: JWK[] }> {
  const key = await getSigningKey()
  return {
    keys: [
      {
        ...key.publicJwk,
        kid: key.keyId,
        alg: 'EdDSA',
        use: 'sig',
      },
    ],
  }
}

export interface SignDeviceTokenInput {
  deviceId: string
  terminalId: string
  branchId: string
  ttlSeconds?: number
}

export async function signDeviceJwt(input: SignDeviceTokenInput): Promise<string> {
  const key = await getSigningKey()
  const ttl = input.ttlSeconds ?? env.POS_JWT_TTL_SECONDS
  const now = Math.floor(Date.now() / 1000)

  return new SignJWT({
    typ: DEVICE_TOKEN_TYPE,
    device_id: input.deviceId,
    terminal_id: input.terminalId,
    branch_id: input.branchId,
  })
    .setProtectedHeader({ alg: 'EdDSA', kid: key.keyId, typ: 'JWT' })
    .setSubject(input.deviceId)
    .setAudience(DEVICE_TOKEN_AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(key.privateKey)
}

export async function signPowersyncJwt(
  input: Omit<SignDeviceTokenInput, 'ttlSeconds'> & { audience: string },
): Promise<{ token: string; expiresAt: Date }> {
  const key = await getSigningKey()
  const ttl = env.POS_JWT_TTL_SECONDS
  const now = Math.floor(Date.now() / 1000)

  const token = await new SignJWT({
    device_id: input.deviceId,
    terminal_id: input.terminalId,
    branch_id: input.branchId,
  })
    .setProtectedHeader({ alg: 'EdDSA', kid: key.keyId, typ: 'JWT' })
    .setSubject(input.deviceId)
    .setAudience(input.audience)
    .setIssuedAt(now)
    .setExpirationTime(now + ttl)
    .sign(key.privateKey)

  return { token, expiresAt: new Date((now + ttl) * 1000) }
}

/**
 * Verifies a device JWT. Every failure mode (bad signature, wrong audience,
 * expired, malformed claims) collapses into the same 401 so callers cannot
 * probe which check failed.
 */
export async function verifyDeviceJwt(token: string): Promise<DeviceTokenClaims> {
  const key = await getSigningKey()

  let payload: Record<string, unknown>
  try {
    const verified = await jwtVerify(token, key.publicKey, {
      algorithms: ['EdDSA'],
      audience: DEVICE_TOKEN_AUDIENCE,
      clockTolerance: 30,
    })
    payload = verified.payload as Record<string, unknown>
  } catch {
    throw new AppError(401, 'DEVICE_TOKEN_INVALID', 'Device token is invalid or expired')
  }

  const deviceId = typeof payload.device_id === 'string' ? payload.device_id : payload.sub
  const terminalId = payload.terminal_id
  const branchId = payload.branch_id

  if (
    payload.typ !== DEVICE_TOKEN_TYPE ||
    typeof deviceId !== 'string' ||
    typeof terminalId !== 'string' ||
    typeof branchId !== 'string'
  ) {
    throw new AppError(401, 'DEVICE_TOKEN_INVALID', 'Device token is invalid or expired')
  }

  return { sub: deviceId, device_id: deviceId, terminal_id: terminalId, branch_id: branchId }
}
