/**
 * `procurement` — purchase orders, receiving against them, supplier returns and the decisions that
 * gate them (Phase 11).
 *
 * The section is online-only: the POS never sees an order, a receipt or a credit note, so nothing
 * here reaches `desktop/**` or the sync streams (00-CONTEXT D14). Money stays integer minor units
 * and every state the screen can offer comes from the server's `canApply`, never a client guess
 * about the lifecycle.
 *
 * The barrel is the only entry point (Plan 09 fills it).
 */
export {}
