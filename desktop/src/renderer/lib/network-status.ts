/**
 * What a failed request actually means.
 *
 * `navigator.onLine === false` is a reliable "this machine has no link". Telling a cashier that
 * the *server domain* is unreachable when the internet is simply off is misleading: it sends
 * someone to check a service that is fine, instead of the connection in front of them.
 *
 * `true` proves nothing though — a link can exist while the server is unreachable — so offline is
 * only ever claimed on a definite `false`.
 */

/** True only when the machine reports no network link at all. */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
}

export interface NetworkFailure {
  code: 'OFFLINE' | 'NETWORK_ERROR'
  message: string
}

/**
 * The code and message for a request that never produced a response.
 *
 * `host` is the API host the request went to, used only when the machine is online and the
 * server is the thing that failed.
 */
export function describeNetworkFailure(host: string): NetworkFailure {
  if (isOffline()) {
    return {
      code: 'OFFLINE',
      message:
        'No internet connection. The till keeps selling offline; this action needs a connection.',
    }
  }
  return { code: 'NETWORK_ERROR', message: `Cannot reach the server at ${host}` }
}
