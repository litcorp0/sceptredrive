import { useEffect, useState } from 'react'

const QUERY = '(prefers-reduced-motion: reduce)'

/**
 * The counter honours the OS motion preference (P10-D8, P10-D14).
 *
 * The hourly chart is the one animated thing on the till. A cashier who has asked the OS for
 * reduced motion gets a chart that is already drawn: Recharts' bars animate by default, so the
 * flag is passed straight through as `isAnimationActive`.
 *
 * The initial read is inside the state initialiser so the first paint already matches the
 * preference — an effect that flipped it afterwards would animate once for exactly the people
 * who asked it not to.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(QUERY).matches,
  )

  useEffect(() => {
    const query = window.matchMedia(QUERY)
    const onChange = (): void => setReduced(query.matches)
    setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  return reduced
}
