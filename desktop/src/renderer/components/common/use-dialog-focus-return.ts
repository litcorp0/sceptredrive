import { useCallback, useRef } from 'react'

/**
 * Returns focus to whatever was focused when the dialog mounted.
 *
 * Radix's `DialogContent` calls `event.preventDefault()` and focuses its
 * `DialogTrigger` on close. Every POS dialog is opened from state — a function
 * key, a panel's `open` flag, a keyboard shortcut — so there is no
 * `DialogTrigger` and Radix's own restore lands on `<body>`. The hand-written
 * `Modal` this replaced captured the previously focused element and focused it
 * on unmount; this keeps that behaviour without bringing the shell back.
 *
 * Spread the result onto the dialog's `DialogContent`:
 *
 * ```tsx
 * const focusReturn = useDialogFocusReturn()
 * <DialogContent {...focusReturn} />
 * ```
 */
export function useDialogFocusReturn(): {
  onCloseAutoFocus: (event: Event) => void
} {
  const opener = useRef<HTMLElement | null>(null)

  if (opener.current === null && typeof document !== 'undefined') {
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }

  const onCloseAutoFocus = useCallback((event: Event) => {
    event.preventDefault()
    opener.current?.focus()
  }, [])

  return { onCloseAutoFocus }
}
