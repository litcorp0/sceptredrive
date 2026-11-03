import { posRuntimeConfig } from '../config'
import { describeNetworkFailure } from '../network-status'
import type { ApiErrorBody, EnrolledDevice, PosSessionPayload } from './types'

/**
 * Typed fetch wrapper for the POS API.
 *
 * - Bearer **device JWT** on every call; no cookies (the terminal has no browser
 *   session and cookies would be shared across the app origin).
 * - One automatic refresh on 401 (the JWT lives 15 minutes; a shift is longer).
 * - 403 `DEVICE_REVOKED` is terminal: the caller must route back to enrolment.
 * - Errors never include request bodies, tokens, or PII.
 */

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: Record<string, unknown> | undefined
  /** `Retry-After` in seconds, when the server sent one (429/503). */
  readonly retryAfterSeconds: number | null

  constructor(
    status: number,
    code: string,
    message: string,
    details?: Record<string, unknown>,
    retryAfterSeconds: number | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.retryAfterSeconds = retryAfterSeconds
  }
}

/** The device was revoked (or its chain is no longer live): re-enrol. */
export class DeviceRevokedError extends ApiError {}

const DEFAULT_TIMEOUT_MS = 15_000
const NETWORK_TIMEOUT = 'REQUEST_TIMEOUT'

let accessToken: string | null = null
let tokenRefresher: (() => Promise<string | null>) | null = null

export function setAccessToken(token: string | null): void {
  accessToken = token
}

export function getAccessToken(): string | null {
  return accessToken
}

/**
 * Registers the session refresher. Injected rather than imported so the API
 * client and the session module stay acyclic (session → client → session would
 * otherwise be a cycle).
 */
export function setTokenRefresher(refresher: (() => Promise<string | null>) | null): void {
  tokenRefresher = refresher
}

/**
 * Asks the session layer for a fresh device JWT.
 *
 * Exported for transports that do not go through `apiRequest` — the payment client — so a stale
 * token heals there too instead of surfacing as "Device token is invalid or expired".
 */
export async function refreshSessionToken(): Promise<string | null> {
  return tokenRefresher ? tokenRefresher() : null
}

async function parseError(response: Response): Promise<ApiError> {
  let body: ApiErrorBody | null = null
  try {
    body = (await response.json()) as ApiErrorBody
  } catch {
    body = null
  }

  const code = body?.error?.code ?? (response.status === 401 ? 'UNAUTHORIZED' : 'API_ERROR')
  const message = body?.error?.message ?? `Request failed with status ${response.status}`
  const ErrorType =
    response.status === 403 && code === 'DEVICE_REVOKED' ? DeviceRevokedError : ApiError
  return new ErrorType(
    response.status,
    code,
    message,
    body?.error?.details,
    parseRetryAfterSeconds(response.headers.get('retry-after')),
  )
}

/** RFC 9110 delta-seconds (the form our API uses). Invalid values are ignored. */
function parseRetryAfterSeconds(header: string | null): number | null {
  if (!header) return null
  const seconds = Number(header.trim())
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}

async function requestOnce(
  path: string,
  init: RequestInit,
  token: string | null,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`${posRuntimeConfig.apiBaseUrl}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init.headers ?? {}),
      },
      credentials: 'omit',
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError(0, NETWORK_TIMEOUT, 'The server did not respond in time')
    }
    // Distinguish "this machine has no internet" from "the server is unreachable": blaming the
    // domain when the link is down sends someone to check the wrong thing.
    const failure = describeNetworkFailure(apiHost())
    throw new ApiError(0, failure.code, failure.message)
  } finally {
    clearTimeout(timer)
  }
}

/** Host of the configured API, for the message above. The URL is validated at boot. */
function apiHost(): string {
  try {
    return new URL(posRuntimeConfig.apiBaseUrl).host
  } catch {
    return 'the configured API'
  }
}

export interface ApiRequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT'
  body?: unknown
  /** Extra request headers (e.g. the POS staff binding token). Never logged. */
  headers?: Record<string, string>
  /** Bearer token override (used by the session call, which sends the device token). */
  bearer?: string
  /** Send no Authorization header at all (enrolment bootstrap). */
  anonymous?: boolean
  timeoutMs?: number
  /** Internal: prevents a refresh loop. */
  retried?: boolean
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const bearer = options.anonymous ? null : (options.bearer ?? accessToken)
  const init: RequestInit = {
    method: options.method ?? 'GET',
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.headers === undefined ? {} : { headers: options.headers }),
  }

  const response = await requestOnce(path, init, bearer, timeoutMs)

  if (
    response.status === 401 &&
    !options.retried &&
    !options.anonymous &&
    !options.bearer &&
    tokenRefresher
  ) {
    const refreshed = await tokenRefresher()
    if (refreshed) {
      return apiRequest<T>(path, { ...options, retried: true })
    }
  }

  if (!response.ok) {
    throw await parseError(response)
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

// --- Endpoints -------------------------------------------------------------

/** Exchanges the device token for a JWT + config snapshot (also the refresh path). */
export function fetchSession(deviceToken: string): Promise<PosSessionPayload> {
  return apiRequest<PosSessionPayload>('/api/pos/session', {
    method: 'POST',
    bearer: deviceToken,
  })
}

export function fetchPowersyncToken(): Promise<{
  endpoint: string
  token: string
  expiresAt: string
}> {
  return apiRequest('/api/pos/powersync/token', { method: 'POST' })
}

/** Redeems an enrollment code; the device token is returned exactly once. */
export function redeemEnrollment(code: string, fingerprint: string): Promise<EnrolledDevice> {
  return apiRequest<EnrolledDevice>('/api/enrollments/redeem', {
    method: 'POST',
    body: { code, fingerprint },
    // No device token yet — this is the bootstrap call.
    anonymous: true,
  })
}
