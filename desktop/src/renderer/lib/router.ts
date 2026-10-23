import { useEffect, useState } from 'react'

/**
 * The POS's tiny hash router (D2: `createHashHistory` semantics, no server).
 *
 * Routes:
 *
 * - `#login`         PIN sign-in / enrollment
 * - `#shift`         open and close the shift
 * - `#pos`           selling (catalog + cart)
 * - `#pos/tender`    payment choice and sale hand-off
 * - `#pos/settings`  terminal settings (manager only)
 * - `#dev/sync`      sync diagnostics
 * - `#spike`         the PowerSync gate panel
 *
 * Keeping this in one pure function means navigation cannot drift from the
 * switch in `main.tsx`.
 */

export interface HashRoute {
  /** First segment, e.g. `pos`, `login`, or `''` for the root. */
  path: string
  segments: string[]
}

export function parseHash(hash: string): HashRoute {
  const clean = hash.replace(/^#+/, '').replace(/^\/+|\/+$/g, '')
  const segments = clean ? clean.split('/').filter(Boolean) : []
  return { path: segments[0] ?? '', segments }
}

/** `navigate('pos/tender')` or `navigate('#pos/tender')`. */
export function navigate(route: string): void {
  const next = route.startsWith('#') ? route : `#${route}`
  if (window.location.hash === next) return
  window.location.hash = next
}

export function currentHash(): string {
  return window.location.hash
}

/** Re-renders on hash changes; the value is parsed on every render. */
export function useHashRoute(): HashRoute {
  const [hash, setHash] = useState(currentHash)

  useEffect(() => {
    const onChange = () => setHash(currentHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  return parseHash(hash)
}

/** Navigates to `target` when `when` is true; used by the POS route guards. */
export function useRedirect(when: boolean, target: string): void {
  useEffect(() => {
    if (when) navigate(target)
  }, [when, target])
}
