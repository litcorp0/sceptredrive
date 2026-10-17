export function firstForwardedIp(header: string | null): string | null {
  if (!header) return null
  const first = header.split(',')[0]?.trim()
  return first && first.length > 0 ? first : null
}

/**
 * Extracts the client IP for audit rows. In production Caddy overwrites
 * X-Forwarded-For before the request reaches the API; locally the API is
 * reached directly, so the header is only trusted in development.
 */
export function clientIpFromHeaders(headers: Headers): string | null {
  return firstForwardedIp(headers.get('x-forwarded-for')) ?? headers.get('x-real-ip')
}
