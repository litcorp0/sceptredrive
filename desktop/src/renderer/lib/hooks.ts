import { useEffect, useState } from 'react'

/**
 * Trailing-edge debounce for a value.
 *
 * The catalogue must not re-query on every keystroke (5k SKUs, an SQLite table
 * scan per character). 150 ms is short enough to feel instant and long enough
 * to swallow a fast typist's burst.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    if (delayMs <= 0) {
      setDebounced(value)
      return
    }
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
