/**
 * A tiny event seam so the services that write an outbox row do not have to
 * import the uploader (and the uploader does not import them).
 *
 * Call `notifyOutboxChanged()` **after** the transaction commits, so the drain
 * always sees the row. The uploader also debounces ~200 ms and keeps a 15-second
 * heartbeat as a backstop.
 */

type Listener = () => void

const listeners = new Set<Listener>()

export function subscribeOutboxChanges(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function notifyOutboxChanged(): void {
  for (const listener of listeners) {
    try {
      listener()
    } catch {
      // A subscriber must never break a sale transaction.
    }
  }
}
