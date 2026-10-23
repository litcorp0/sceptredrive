import { useEffect, useRef } from 'react'

/**
 * Global keyboard shortcuts for the selling screens (Plan 06 Task 1).
 *
 * F-keys work everywhere (they are what a POS keyboard offers); everything else
 * is ignored while the cashier is typing in a field, so a barcode or a customer
 * name never triggers a command. Handlers are kept in a ref so re-renders do
 * not churn the listener.
 */

export type ShortcutHandlers = Record<string, (event: KeyboardEvent) => void>

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

export function usePosShortcuts(handlers: ShortcutHandlers, enabled = true): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!enabled) return

    function onKeyDown(event: KeyboardEvent): void {
      if (event.metaKey || event.ctrlKey || event.altKey) return

      const handler = handlersRef.current[event.key]
      if (!handler) return

      // Function keys are always commands; printable keys and Escape only when
      // no field has focus (Escape must still close a browser dialog though).
      if (isEditable(event.target) && !event.key.startsWith('F')) return
      if (
        event.key === 'Escape' &&
        isEditable(event.target) &&
        event.target instanceof HTMLInputElement &&
        event.target.dataset.allowEscape !== 'true'
      ) {
        return
      }

      event.preventDefault()
      handler(event)
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [enabled])
}
