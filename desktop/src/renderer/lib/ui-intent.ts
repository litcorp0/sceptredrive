/**
 * One-shot UI intents that have to survive a hash navigation (P10-D7).
 *
 * The POS router is `window.location.hash` (`lib/router.ts`), so "go to the sell screen and
 * put the cursor in the search field" is two events: a hash change that mounts a different
 * page, and a focus call that can only happen once that page exists. Passing that through a
 * query string would put router state in the URL; a state library would be a dependency for
 * one boolean.
 *
 * A module-level variable is the smallest thing that works: the navigation is a same-page-load
 * hash change, so the module instance survives it, and `consumeFocus` clears the intent the
 * moment the target screen acts on it. Nothing is persisted, so a relaunch never replays a
 * stale focus.
 *
 * F2 has one meaning on the counter — *find an item* (P10-D7). On the sell screen that is the
 * search field; on the home screen it is "go where items are found", which is the sell screen
 * with the same field focused.
 */

/** The intents a screen may ask for. Extend the union, not the mechanism. */
export type FocusIntent = 'search'

let pending: FocusIntent | null = null

/**
 * Records that the next screen should focus `intent`.
 *
 * Called immediately before `navigate()`, so the intent is already set when the target page
 * mounts. Requesting the same intent twice is harmless: the flag is read once.
 */
export function requestFocus(intent: FocusIntent): void {
  pending = intent
}

/**
 * True exactly once per `requestFocus`, on the screen that asked for it.
 *
 * A screen that receives but cannot act (no input yet) must not call this, or the one shot is
 * spent; callers focus first and consume second only when the target exists.
 */
export function consumeFocus(intent: FocusIntent): boolean {
  if (pending !== intent) return false
  pending = null
  return true
}

/** Test/teardown hook: forget any intent that was set but never consumed. */
export function clearFocusIntent(): void {
  pending = null
}
