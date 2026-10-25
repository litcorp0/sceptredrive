import { useEffect, useRef } from 'react'
import { createScanBuffer } from '@/lib/catalog/scan-buffer'
import { isEditableElement } from '@/lib/dom'

/**
 * Global keyboard-wedge listener (Plan 06 Task 2).
 *
 * A scanner types and presses Enter. When no field has focus we recognise the
 * burst and hand the code up; when a field *is* focused (the search box), the
 * field's own Enter handler does the lookup, so nothing is added twice.
 *
 * No keylogger library and no key capture: printable keys are observed, never
 * prevented, so typing still works everywhere it should.
 */
export function ScanListener({
  onScan,
  enabled = true,
}: {
  onScan: (code: string) => void
  enabled?: boolean
}) {
  const buffer = useRef(createScanBuffer())
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  useEffect(() => {
    if (!enabled) return

    function onKeyDown(event: KeyboardEvent): void {
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableElement(event.target)) {
        buffer.current.reset()
        return
      }

      if (event.key === 'Enter') {
        const code = buffer.current.push('\n')
        if (code) {
          event.preventDefault()
          onScanRef.current(code)
        }
        return
      }

      if (event.key.length === 1) buffer.current.push(event.key)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])

  return null
}
