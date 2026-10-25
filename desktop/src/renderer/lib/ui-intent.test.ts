import { beforeEach, describe, expect, it } from 'vitest'
import { clearFocusIntent, consumeFocus, requestFocus } from './ui-intent'

/**
 * The one-shot focus hand-off (P10-D7).
 *
 * The important property is that it is *one* shot: a stale intent must never steal the cursor
 * on a later hash navigation, and an intent for a different target must not be consumed.
 */

describe('ui-intent', () => {
  beforeEach(() => {
    clearFocusIntent()
  })

  it('is consumed exactly once', () => {
    requestFocus('search')

    expect(consumeFocus('search')).toBe(true)
    expect(consumeFocus('search')).toBe(false)
  })

  it('does nothing when no intent was requested', () => {
    expect(consumeFocus('search')).toBe(false)
  })

  it('keeps only the latest request', () => {
    requestFocus('search')
    requestFocus('search')

    expect(consumeFocus('search')).toBe(true)
    expect(consumeFocus('search')).toBe(false)
  })

  it('can be cleared without being consumed, so a relaunch has no stale cursor', () => {
    requestFocus('search')
    clearFocusIntent()

    expect(consumeFocus('search')).toBe(false)
  })
})
