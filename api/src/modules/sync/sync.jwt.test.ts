import { decodeProtectedHeader, importJWK, type JWK, jwtVerify, SignJWT } from 'jose'
import { afterEach, describe, expect, it } from 'vitest'
import { app } from '../../app.ts'
import { AppError } from '../../http/errors.ts'
import {
  DEVICE_TOKEN_AUDIENCE,
  getJwks,
  getSigningKey,
  resetSigningKeyForTests,
  signDeviceJwt,
  signPowersyncJwt,
  verifyDeviceJwt,
} from './sync.jwt.ts'

const DEVICE = {
  deviceId: '11111111-1111-4111-8111-111111111111',
  terminalId: '22222222-2222-4222-8222-222222222222',
  branchId: '33333333-3333-4333-8333-333333333333',
}

afterEach(() => {
  resetSigningKeyForTests()
})

describe('POS JWT signing', () => {
  it('round-trips a device token', async () => {
    const token = await signDeviceJwt(DEVICE)
    const claims = await verifyDeviceJwt(token)

    expect(claims).toEqual({
      sub: DEVICE.deviceId,
      device_id: DEVICE.deviceId,
      terminal_id: DEVICE.terminalId,
      branch_id: DEVICE.branchId,
    })
  })

  it('signs with the configured key id and EdDSA', async () => {
    const key = await getSigningKey()
    const header = decodeProtectedHeader(await signDeviceJwt(DEVICE))

    expect(header.alg).toBe('EdDSA')
    expect(header.kid).toBe(key.keyId)
  })

  it('rejects a token signed for another audience', async () => {
    const key = await getSigningKey()
    const token = await new SignJWT({ typ: 'device', device_id: DEVICE.deviceId })
      .setProtectedHeader({ alg: 'EdDSA', kid: key.keyId })
      .setSubject(DEVICE.deviceId)
      .setAudience('some-other-audience')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key.privateKey)

    await expect(verifyDeviceJwt(token)).rejects.toMatchObject({ statusCode: 401 })
  })

  it('rejects an expired token', async () => {
    const key = await getSigningKey()
    const now = Math.floor(Date.now() / 1000)
    const token = await new SignJWT({
      typ: 'device',
      device_id: DEVICE.deviceId,
      terminal_id: DEVICE.terminalId,
      branch_id: DEVICE.branchId,
    })
      .setProtectedHeader({ alg: 'EdDSA', kid: key.keyId })
      .setSubject(DEVICE.deviceId)
      .setAudience(DEVICE_TOKEN_AUDIENCE)
      .setIssuedAt(now - 600)
      .setExpirationTime(now - 300)
      .sign(key.privateKey)

    await expect(verifyDeviceJwt(token)).rejects.toBeInstanceOf(AppError)
  })

  it('rejects a tampered signature', async () => {
    const token = await signDeviceJwt(DEVICE)
    const [header, payload, signature] = token.split('.') as [string, string, string]

    // Flip one character in the middle of the signature segment. Base64url's
    // trailing characters share padding bits, so rewriting the last two could
    // decode to the same bytes and leave a valid token; a middle character is
    // fully significant and the replacement is guaranteed to differ.
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
    const index = Math.floor(signature.length / 2)
    const current = signature[index] as string
    const replacement = alphabet[(alphabet.indexOf(current) + 1) % alphabet.length] as string
    expect(replacement).not.toBe(current)
    const flipped = `${signature.slice(0, index)}${replacement}${signature.slice(index + 1)}`

    await expect(verifyDeviceJwt(`${header}.${payload}.${flipped}`)).rejects.toMatchObject({
      code: 'DEVICE_TOKEN_INVALID',
    })
  })

  it('rejects a token without the device claims', async () => {
    const key = await getSigningKey()
    const token = await new SignJWT({ typ: 'device' })
      .setProtectedHeader({ alg: 'EdDSA', kid: key.keyId })
      .setSubject(DEVICE.deviceId)
      .setAudience(DEVICE_TOKEN_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key.privateKey)

    await expect(verifyDeviceJwt(token)).rejects.toMatchObject({ code: 'DEVICE_TOKEN_INVALID' })
  })

  it('issues a PowerSync token scoped to the terminal branch', async () => {
    const audience = 'http://localhost:8080'
    const { token, expiresAt } = await signPowersyncJwt({ ...DEVICE, audience })

    const key = await getSigningKey()
    const { payload } = await jwtVerify(token, key.publicKey, { audience })

    expect(payload.branch_id).toBe(DEVICE.branchId)
    expect(payload.terminal_id).toBe(DEVICE.terminalId)
    expect(payload.device_id).toBe(DEVICE.deviceId)
    expect(payload.sub).toBe(DEVICE.deviceId)
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('publishes a single public key with no private material', async () => {
    const key = await getSigningKey()
    const jwks = await getJwks()

    expect(jwks.keys).toHaveLength(1)
    const [jwk] = jwks.keys
    expect(jwk?.kid).toBe(key.keyId)
    expect(jwk?.kty).toBe('OKP')
    expect(jwk?.crv).toBe('Ed25519')
    expect(jwk?.d).toBeUndefined()
    expect(Object.keys(jwk ?? {})).not.toContain('d')
    expect(JSON.stringify(jwks)).not.toMatch(/"d":/)
  })

  it('serves the JWKS over HTTP without private material', async () => {
    const response = await app.request('/.well-known/jwks.json')
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('max-age')

    const body = (await response.json()) as { keys: Array<{ kid?: string; d?: string }> }
    expect(body.keys).toHaveLength(1)
    expect(body.keys[0]?.kid).toBe((await getSigningKey()).keyId)
    expect(body.keys[0]?.d).toBeUndefined()

    const alias = await app.request('/api/.well-known/jwks.json')
    expect(alias.status).toBe(200)
  })

  it('exposes a JWK that verifies a token independently of the key object', async () => {
    const token = await signDeviceJwt(DEVICE)
    const jwks = await getJwks()
    const key = await importJWK(jwks.keys[0] as JWK, 'EdDSA')

    const { payload } = await jwtVerify(token, key, { audience: DEVICE_TOKEN_AUDIENCE })
    expect(payload.branch_id).toBe(DEVICE.branchId)
  })
})
