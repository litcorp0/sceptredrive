import { MAX_HELD_CARTS } from '@sceptre/shared'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ManagerOverrideDialog, StatusNote } from '@/components/common'
import { AppHeader } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import type { PosConfigSnapshot } from '@/lib/api/types'
import { endStaffSession, type StaffSession } from '@/lib/auth/staff-session'
import { useCart } from '@/lib/cart/cart-store'
import { cartReducer } from '@/lib/cart/reducer'
import { computeCartTotals } from '@/lib/cart/totals'
import type { CartDiscount } from '@/lib/cart/types'
import { cartVoidLines, recordCartVoid } from '@/lib/cart/void-service'
import { lookupScannedProduct } from '@/lib/catalog/resolve'
import { overLimitMinor } from '@/lib/credit/headroom'
import { useCustomerContext } from '@/lib/customers/context'
import type { CustomerHit } from '@/lib/customers/search'
import { discountAuthority } from '@/lib/discounts/discount-service'
import { formatGhs } from '@/lib/format'
import {
  type HeldCartSummary,
  holdCart,
  listHeldCarts,
  type RecallResult,
  recallHeldCart,
  voidHeldCart,
} from '@/lib/hold/hold-service'
import { lockoutPolicyFor } from '@/lib/pos-config'
import type { OpenShiftSummary, PosIdentityRow } from '@/lib/pos-runtime'
import { usePosDatabase } from '@/lib/powersync/provider'
import { navigate } from '@/lib/router'
import { usePosShortcuts } from '@/lib/shortcuts'
import { consumeFocus } from '@/lib/ui-intent'
import { CartLineRow, CartTotalsPanel } from '@/modules/cart'
import { CatalogBrowser } from '@/modules/catalog'
import { CreditPanel } from '@/modules/credit'
import { CustomerPanel } from '@/modules/customers'
import { LoyaltyPanel } from '@/modules/loyalty'
import { DiscountDialog } from '../components/discount-dialog'
import { HoldCartDialog } from '../components/hold-cart-dialog'
import { HoldsTray } from '../components/holds-tray'
import { RecallDifferences } from '../components/recall-differences'
import { VoidCartDialog, type VoidCartInput } from '../components/void-cart-dialog'

/**
 * The selling screen (Plan 06; holds and voids in Phase 13 Plan 11).
 *
 * Three columns, left to right: what you are adding, what you have added, and
 * who it is for. A counter screen is glanceable and touchable: large targets,
 * no hover-only controls, and the total always visible.
 *
 * Two Phase 13 rules shape the interactions here:
 *
 * - **Nothing silently discards a basket.** Clearing, voiding a hold, and
 *   recalling over a non-empty cart all go through a recorded path.
 * - **A recalled cart cannot complete until its changes are seen.** The Pay
 *   control stays disabled while a recall needs acknowledgement or a line's
 *   product is gone, and the reason is always on screen.
 */
export function SellScreen({
  identity,
  shift,
  staff,
  config,
}: {
  identity: PosIdentityRow
  shift: OpenShiftSummary | null
  staff: StaffSession
  config: PosConfigSnapshot
}) {
  const {
    state,
    totals,
    pricing,
    dispatch,
    clear,
    status,
    error,
    addProduct,
    setCustomer,
    cartTenders,
    setCartTenders,
  } = useCart()
  const db = usePosDatabase()
  const customerContext = useCustomerContext(state.customer, identity.branchId)
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [holds, setHolds] = useState<HeldCartSummary[]>([])
  const [holdsBusy, setHoldsBusy] = useState(false)
  const [holdDialog, setHoldDialog] = useState(false)
  const [voidTarget, setVoidTarget] = useState<VoidTarget | null>(null)
  const [recall, setRecall] = useState<RecallState | null>(null)
  const [showCustomer, setShowCustomer] = useState(false)
  const [showLoyalty, setShowLoyalty] = useState(false)
  const [showCreditOverride, setShowCreditOverride] = useState(false)
  const [discountTarget, setDiscountTarget] = useState<DiscountTarget | null>(null)
  const [pendingDiscount, setPendingDiscount] = useState<PendingDiscount | null>(null)
  const [showDiscountOverride, setShowDiscountOverride] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  // `F3` walks the queue instead of always taking the oldest basket, so a
  // cashier serving out of order does not have to use the mouse.
  const recallCursor = useRef(0)

  // F2 means "find an item" on both screens (P10-D7). Home records the intent before it
  // navigates; this is the one place that acts on it, and it acts exactly once.
  useEffect(() => {
    if (consumeFocus('search')) searchRef.current?.focus()
  }, [])

  const refreshHolds = useCallback(async () => {
    setHolds(await listHeldCarts(db))
  }, [db])

  useEffect(() => {
    void refreshHolds()
  }, [refreshHolds])

  const dialogOpen =
    holdDialog ||
    Boolean(voidTarget) ||
    showCustomer ||
    showLoyalty ||
    showCreditOverride ||
    Boolean(discountTarget) ||
    showDiscountOverride

  function applyCustomer(hit: CustomerHit) {
    if (!hit.customerId && !hit.draftId) {
      setCustomer(null)
      return
    }
    setCustomer({
      customerId: hit.customerId,
      draftId: hit.draftId,
      name: hit.name,
      phone: hit.phone,
      isDraft: hit.isDraft,
    })
  }

  const canSettings = staff.role === 'MANAGER' || staff.role === 'ADMIN'
  const selectedLine = state.lines.find((line) => line.id === selectedLineId) ?? null

  // Keep a selection when lines change: prefer the current one, else the last.
  useEffect(() => {
    if (state.lines.length === 0) {
      setSelectedLineId(null)
      return
    }
    if (!selectedLineId || !state.lines.some((line) => line.id === selectedLineId)) {
      setSelectedLineId(state.lines[state.lines.length - 1]?.id ?? null)
    }
  }, [state.lines, selectedLineId])

  /**
   * The recall gate. A blocking product still in the cart stops completion
   * outright; a price or tax change needs one acknowledgement, which survives
   * until the next recall. A difference whose product the cashier has already
   * removed no longer asks for anything — a new basket must never be blocked by
   * an old cart's changes.
   */
  const blockingInCart = recall
    ? recall.blockingProductIds.filter((productId) =>
        state.lines.some((line) => line.productId === productId),
      )
    : []
  const differencesInCart = recall
    ? recall.differences.filter((difference) =>
        state.lines.some((line) => line.productId === difference.productId),
      )
    : []
  const needsAcknowledgement = Boolean(
    recall?.requiresAcknowledgement && !recall.acknowledged && differencesInCart.length > 0,
  )
  const completionBlocked = blockingInCart.length > 0 || needsAcknowledgement
  const blockReason =
    blockingInCart.length > 0
      ? 'Remove or replace the line whose product is archived or gone before taking payment.'
      : 'Acknowledge what changed while this cart was held before taking payment.'

  const setQuantity = useCallback(
    (lineId: string, quantity: number) => {
      setSelectedLineId(lineId)
      dispatch({ type: 'setQuantity', lineId, quantity })
    },
    [dispatch],
  )

  const handleScan = useCallback(
    (code: string) => {
      void lookupScannedProduct(db, code, identity.branchId).then((result) => {
        if (result.status === 'found') {
          addProduct(result.product)
          setNotice(null)
          return
        }
        if (result.status === 'unknown') {
          setNotice(`No product for “${code}”. Search for it, then ask the office to add it.`)
          return
        }
        setNotice(`“${result.row.name}” cannot be sold: its price or tax category is missing.`)
      })
    },
    [addProduct, db, identity.branchId],
  )

  const goTender = useCallback(() => {
    if (state.lines.length === 0) {
      setNotice('Add a product before taking payment')
      return
    }
    if (completionBlocked) {
      setNotice(blockReason)
      return
    }
    if (!shift) {
      setNotice('Open a shift before completing a sale')
      return
    }
    navigate('pos/tender')
  }, [blockReason, completionBlocked, state.lines.length, shift])

  type DiscountTarget = { kind: 'sale' } | { kind: 'line'; lineId: string }
  type VoidTarget = { kind: 'cart' } | { kind: 'hold'; hold: HeldCartSummary }
  interface RecallState extends RecallResult {
    acknowledged: boolean
    collapsed: boolean
  }
  interface PendingDiscount {
    target: DiscountTarget
    discount: CartDiscount
    overByMinor: number
  }

  const discountLine =
    discountTarget?.kind === 'line'
      ? (state.lines.find((line) => line.id === discountTarget.lineId) ?? null)
      : null
  const lineDiscountBase = discountLine ? discountLine.unitPriceMinor * discountLine.quantity : 0
  const saleDiscountBase = totals.priced.subtotalMinor - totals.priced.lineDiscountMinor
  const lineDiscount: CartDiscount | null =
    discountLine && discountLine.lineDiscountMinor > 0 && discountLine.discountReasonCode
      ? {
          amountMinor: discountLine.lineDiscountMinor,
          reasonCode: discountLine.discountReasonCode,
          note: discountLine.discountNote,
          override: discountLine.discountOverride,
        }
      : null

  function applyDiscount(target: DiscountTarget, discount: CartDiscount | null) {
    if (target.kind === 'sale') {
      dispatch({ type: 'setSaleDiscount', discount })
      return
    }
    dispatch({ type: 'setLineDiscount', lineId: target.lineId, discount })
  }

  /**
   * Applies a discount, or routes it through a manager first when the resulting
   * total discount is above this person's cap. The check runs on the *result*, so
   * adding a line discount can push a sale-level discount over the line.
   */
  function submitDiscount(discount: CartDiscount | null) {
    if (!discountTarget) return
    const target = discountTarget

    const candidate =
      target.kind === 'sale'
        ? cartReducer(state, { type: 'setSaleDiscount', discount })
        : cartReducer(state, { type: 'setLineDiscount', lineId: target.lineId, discount })
    const projected = computeCartTotals(candidate, pricing)

    const authority = discountAuthority({
      role: staff.role,
      totalDiscountMinor: projected.totalDiscountMinor,
      grossMinor: projected.grossMinor,
      caps: config.pos,
      hasApproval: Boolean(discount?.override),
    })

    setDiscountTarget(null)

    if (!discount || authority.approved) {
      applyDiscount(target, discount)
      return
    }

    setPendingDiscount({ target, discount, overByMinor: authority.overByMinor })
    setShowDiscountOverride(true)
  }

  /** Parks the basket, then clears the sell screen. A failed hold changes nothing. */
  async function handleHold(label: string) {
    await holdCart(db, {
      label,
      cart: {
        lines: state.lines,
        saleDiscount: state.saleDiscount,
        loyaltyRedeemPoints: state.loyaltyRedeemPoints,
        customer: state.customer,
        totals,
        shiftId: state.shiftId,
      },
    })
    setHoldDialog(false)
    clear()
    setCartTenders([])
    setSelectedLineId(null)
    setRecall(null)
    await refreshHolds()
    setNotice(`Held “${label}”. Recall it from the tray above the products.`)
  }

  /** Recalls a hold; a non-empty basket is parked first under `Cart #N`. */
  async function handleRecall(hold: HeldCartSummary) {
    if (cartTenders.length > 0) {
      setNotice('Finish or cancel the pending payment before recalling another cart')
      return
    }
    setHoldsBusy(true)
    try {
      const result = await recallHeldCart(db, hold.id, {
        shiftId: state.shiftId,
        activeCart: {
          lines: state.lines,
          saleDiscount: state.saleDiscount,
          loyaltyRedeemPoints: state.loyaltyRedeemPoints,
          customer: state.customer,
          totals,
          shiftId: state.shiftId,
        },
      })

      dispatch({ type: 'hydrate', state: result.cart })
      setCartTenders([])
      setSelectedLineId(null)
      setRecall({
        ...result,
        acknowledged: !result.requiresAcknowledgement,
        collapsed: false,
      })
      await refreshHolds()
      setNotice(
        result.autoHeld
          ? `“${result.autoHeld.label}” was held to make room for “${hold.label}”.`
          : `Recalled “${hold.label}”.`,
      )
    } catch (recallError) {
      setNotice(
        recallError instanceof Error ? recallError.message : 'That cart could not be recalled',
      )
    } finally {
      setHoldsBusy(false)
    }
  }

  function recallNext() {
    if (holds.length === 0) {
      setNotice('No carts are held')
      return
    }
    const hold = holds[recallCursor.current % holds.length]
    recallCursor.current += 1
    if (hold) void handleRecall(hold)
  }

  /** One reason-coded void: the live basket or a held one. */
  async function handleVoid(input: VoidCartInput) {
    if (!voidTarget) return
    if (voidTarget.kind === 'hold') {
      await voidHeldCart(db, voidTarget.hold.id, input.reasonCode, input.note)
      await refreshHolds()
    } else {
      await recordCartVoid(db, {
        lines: cartVoidLines(state),
        itemCount: totals.itemCount,
        grossMinor: totals.priced.totalMinor,
        reasonCode: input.reasonCode,
        note: input.note,
      })
      clear()
      setCartTenders([])
      setSelectedLineId(null)
      setRecall(null)
    }
    setVoidTarget(null)
  }

  function removeBlockingLines() {
    for (const line of state.lines) {
      if (blockingInCart.includes(line.productId)) {
        dispatch({ type: 'removeLine', lineId: line.id })
      }
    }
  }

  usePosShortcuts(
    useMemo(
      () => ({
        F2: () => searchRef.current?.focus(),
        // F3 walks the held carts, oldest first; F5 parks the current one.
        F3: recallNext,
        F4: () => setShowCustomer(true),
        F5: () => {
          if (state.lines.length === 0) {
            setNotice('Add an item before holding the cart')
            return
          }
          setHoldDialog(true)
        },
        F6: () => {
          if (!state.customer) {
            setNotice('Choose a customer before redeeming points')
            return
          }
          setShowLoyalty(true)
        },
        // A refund is not a cart action: it works with an empty basket, and the
        // draft is restored when the cashier comes back (Plan 10).
        F7: () => navigate('pos/refund'),
        F8: () => {
          if (state.lines.length === 0) {
            setNotice('Add an item before discounting the sale')
            return
          }
          setDiscountTarget({ kind: 'sale' })
        },
        F9: goTender,
        ArrowDown: () => {
          const index = state.lines.findIndex((line) => line.id === selectedLineId)
          const next = state.lines[Math.min(index + 1, state.lines.length - 1)]
          if (next) setSelectedLineId(next.id)
        },
        ArrowUp: () => {
          const index = state.lines.findIndex((line) => line.id === selectedLineId)
          const next = state.lines[Math.max(index - 1, 0)]
          if (next) setSelectedLineId(next.id)
        },
        '+': () => {
          if (selectedLine) setQuantity(selectedLine.id, selectedLine.quantity + 1)
        },
        '-': () => {
          if (selectedLine) setQuantity(selectedLine.id, selectedLine.quantity - 1)
        },
        Escape: () => setSelectedLineId(null),
      }),
      [goTender, holds, selectedLine, selectedLineId, setQuantity, state.customer, state.lines],
    ),
    !dialogOpen,
  )

  function lock() {
    if (shift) {
      setNotice('Close the shift before locking the terminal')
      return
    }
    endStaffSession()
    navigate('login')
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <AppHeader
        identity={identity}
        shift={shift}
        staff={staff}
        onLock={lock}
        onSettings={canSettings ? () => navigate('pos/settings') : undefined}
        lockNote={shift ? 'Close the shift before locking' : 'Sign out of this terminal'}
      />

      {notice ? (
        <StatusNote
          tone="notice"
          role="status"
          aria-live="polite"
          className="rounded-none border-x-0 border-t-0 px-5 py-1.5 text-sm"
          action={
            <Button
              type="button"
              variant="ghost"
              onClick={() => setNotice(null)}
              className="h-11 min-w-11 px-2 text-xs text-foreground hover:bg-foreground/5"
            >
              Dismiss
            </Button>
          }
        >
          {notice}
        </StatusNote>
      ) : null}

      {error ? (
        <StatusNote
          tone="danger"
          role="alert"
          className="rounded-none border-x-0 border-t-0 px-5 py-1.5 text-sm"
        >
          {error}
        </StatusNote>
      ) : null}

      <main className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)_280px] lg:overflow-hidden">
        <div className="flex min-h-0 flex-col">
          <HoldsTray
            holds={holds}
            busy={holdsBusy}
            onRecall={(hold) => void handleRecall(hold)}
            onVoid={(hold) => setVoidTarget({ kind: 'hold', hold })}
          />
          <CatalogBrowser
            branchId={identity.branchId}
            focusRef={searchRef}
            scanEnabled={!dialogOpen}
            onAdd={addProduct}
            onUnknown={(code) => setNotice(`No product for “${code}”.`)}
            onScan={handleScan}
          />
        </div>

        <section aria-label="Cart" className="flex min-h-0 flex-col border-border lg:border-r">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-1.5">
            <h1 className="text-sm font-semibold">
              Current sale{' '}
              <span className="font-normal text-muted-foreground tabular-nums">
                {totals.itemCount} items
              </span>
            </h1>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('pos/refund')}
                className="h-11 min-w-11 px-3 text-xs"
                title="Refund a receipt (F7)"
                data-testid="sell-refund"
              >
                Refund{' '}
                <span className="font-mono text-[11px] font-normal text-muted-foreground">F7</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDiscountTarget({ kind: 'sale' })}
                disabled={state.lines.length === 0}
                className="h-11 min-w-11 px-3 text-xs"
                title="Discount the whole sale (F8)"
              >
                Discount{' '}
                <span className="font-mono text-[11px] font-normal text-muted-foreground">F8</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setHoldDialog(true)}
                disabled={state.lines.length === 0 || holds.length >= MAX_HELD_CARTS}
                className="h-11 min-w-11 px-3 text-xs"
                title="Park this cart (F5)"
                data-testid="sell-hold"
              >
                Hold{' '}
                <span className="font-mono text-[11px] font-normal text-muted-foreground">F5</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setVoidTarget({ kind: 'cart' })}
                disabled={state.lines.length === 0}
                className="h-11 min-w-11 px-3 text-xs"
                title="Discard this cart with a reason"
                data-testid="sell-void-cart"
              >
                Void cart
              </Button>
            </div>
          </div>

          {state.lines.length > 0 ? (
            <p
              className="border-b border-border px-4 py-1 text-[11px] text-muted-foreground"
              data-testid="cart-shortcuts"
            >
              <kbd className="font-mono">↑ ↓</kbd> select a line ·{' '}
              <kbd className="font-mono">+ −</kbd> quantity · <kbd className="font-mono">Esc</kbd>{' '}
              deselect
            </p>
          ) : null}

          {recall && !recall.collapsed ? (
            <RecallDifferences
              differences={recall.differences}
              blockingProductIds={blockingInCart}
              loyalty={recall.loyalty}
              acknowledged={recall.acknowledged}
              onAcknowledge={() => setRecall({ ...recall, acknowledged: true })}
              onRemoveBlocking={removeBlockingLines}
              onDismiss={() => setRecall({ ...recall, collapsed: true })}
            />
          ) : null}

          {completionBlocked ? (
            <StatusNote tone="notice" role="status" className="m-2 text-xs">
              <span>{blockReason}</span>{' '}
              {recall?.collapsed ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setRecall({ ...recall, collapsed: false })}
                  className="h-7 px-2 text-[11px] underline-offset-2 hover:underline"
                >
                  Show changes
                </Button>
              ) : null}
            </StatusNote>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {status === 'loading' ? (
              <div className="grid gap-2 p-1">
                <span className="sr-only">Restoring the cart…</span>
                {[0, 1, 2].map((index) => (
                  <div key={index} className="rounded-lg border border-border bg-card p-2.5">
                    <Skeleton className="h-4 w-2/3" />
                    <div className="mt-2 flex items-center gap-2">
                      <Skeleton className="h-11 w-11" />
                      <Skeleton className="h-11 w-12" />
                      <Skeleton className="h-11 w-11" />
                      <Skeleton className="ml-auto h-11 w-20" />
                    </div>
                  </div>
                ))}
              </div>
            ) : state.lines.length === 0 ? (
              <Empty className="h-full gap-2 border-0 p-6 md:p-6">
                <EmptyHeader className="max-w-sm">
                  <EmptyTitle className="text-sm font-normal text-muted-foreground">
                    Scan a barcode or search for a product to start the sale.
                  </EmptyTitle>
                </EmptyHeader>
              </Empty>
            ) : (
              <ul className="grid gap-2">
                {state.lines.map((line, index) => {
                  const pricedLine = totals.priced.lines[index]
                  if (!pricedLine) return null
                  return (
                    <CartLineRow
                      key={line.id}
                      line={line}
                      priced={pricedLine}
                      selected={line.id === selectedLineId}
                      onSelect={() => setSelectedLineId(line.id)}
                      onQuantity={(quantity) => setQuantity(line.id, quantity)}
                      onRemove={() => dispatch({ type: 'removeLine', lineId: line.id })}
                      onDiscount={() => setDiscountTarget({ kind: 'line', lineId: line.id })}
                    />
                  )
                })}
              </ul>
            )}
          </div>

          <div className="border-t border-border p-4">
            <CartTotalsPanel totals={totals} />
            <Button
              type="button"
              onClick={goTender}
              disabled={state.lines.length === 0 || completionBlocked}
              className="mt-3 h-14 w-full text-base"
              data-testid="pay-button"
            >
              Pay {formatGhs(totals.priced.totalMinor)}{' '}
              <span className="ml-1 font-mono text-xs font-normal tabular-nums opacity-70">F9</span>
            </Button>
          </div>
        </section>

        <aside
          aria-label="Customer, loyalty, and credit"
          className="min-h-0 border-t border-border lg:overflow-y-auto lg:border-t-0"
        >
          <div className="grid gap-3 p-3 md:grid-cols-3 lg:grid-cols-1">
            <CustomerPanel
              customer={state.customer}
              context={customerContext}
              open={showCustomer}
              onFind={() => setShowCustomer(true)}
              onClose={() => setShowCustomer(false)}
              onSelect={applyCustomer}
              onClear={() => setCustomer(null)}
            />
            <LoyaltyPanel
              customer={state.customer}
              loyalty={customerContext.loyalty}
              totals={totals}
              redeemPoints={state.loyaltyRedeemPoints}
              config={config.loyalty}
              open={showLoyalty}
              onRedeem={() => setShowLoyalty(true)}
              onClose={() => setShowLoyalty(false)}
              onPreview={(points) => {
                const projected = computeCartTotals(
                  { ...state, loyaltyRedeemPoints: points },
                  pricing,
                )
                return {
                  totalMinor: projected.priced.totalMinor,
                  appliedMinor: projected.loyaltyDiscountMinor,
                }
              }}
              onConfirm={(points) => dispatch({ type: 'setLoyaltyRedeem', points })}
              onClear={() => dispatch({ type: 'setLoyaltyRedeem', points: 0 })}
            />
            <CreditPanel
              customer={state.customer}
              credit={customerContext.credit}
              totalMinor={totals.priced.totalMinor}
              override={state.creditOverride}
              onRequestApproval={() => setShowCreditOverride(true)}
              onClearApproval={() => dispatch({ type: 'setCreditOverride', override: null })}
            />
          </div>
        </aside>
      </main>

      {discountTarget ? (
        <DiscountDialog
          title={discountTarget.kind === 'sale' ? 'Sale discount' : 'Line discount'}
          description={
            discountTarget.kind === 'sale'
              ? 'Applied across every line, pro-rata, before tax.'
              : 'Applies to this line only, before tax.'
          }
          baseMinor={discountTarget.kind === 'sale' ? saleDiscountBase : lineDiscountBase}
          existing={discountTarget.kind === 'sale' ? state.saleDiscount : lineDiscount}
          role={staff.role}
          caps={config.pos}
          onClose={() => setDiscountTarget(null)}
          onSubmit={submitDiscount}
        />
      ) : null}

      {showDiscountOverride ? (
        <ManagerOverrideDialog
          title="Discount approval"
          description="This discount is above the cap for a cashier."
          permission="pos.discount"
          overByMinor={pendingDiscount?.overByMinor ?? 0}
          policy={lockoutPolicyFor(config)}
          onClose={() => {
            setShowDiscountOverride(false)
            setPendingDiscount(null)
          }}
          onApproved={(proof) => {
            if (!pendingDiscount) return
            applyDiscount(pendingDiscount.target, {
              ...pendingDiscount.discount,
              override: proof,
            })
            setPendingDiscount(null)
          }}
        />
      ) : null}

      {showCreditOverride ? (
        <ManagerOverrideDialog
          title="Credit approval"
          description="A manager approves selling on credit beyond the limit or on a held account."
          permission="credit.override"
          amountMinor={totals.priced.totalMinor}
          overByMinor={overLimitMinor(customerContext.credit, totals.priced.totalMinor)}
          policy={lockoutPolicyFor(config)}
          onClose={() => setShowCreditOverride(false)}
          onApproved={(proof) => dispatch({ type: 'setCreditOverride', override: proof })}
          onBypass={() => {
            dispatch({ type: 'setCreditOverride', override: null })
            setNotice(
              'Continuing without approval — the server will record the over-limit conflict.',
            )
          }}
        />
      ) : null}

      {holdDialog ? (
        <HoldCartDialog
          existingCount={holds.length}
          onClose={() => setHoldDialog(false)}
          onConfirm={handleHold}
        />
      ) : null}

      {voidTarget ? (
        <VoidCartDialog
          itemCount={voidTarget.kind === 'hold' ? voidTarget.hold.itemCount : totals.itemCount}
          totalMinor={
            voidTarget.kind === 'hold' ? voidTarget.hold.totalMinor : totals.priced.totalMinor
          }
          label={voidTarget.kind === 'hold' ? voidTarget.hold.label : null}
          onClose={() => setVoidTarget(null)}
          onConfirm={handleVoid}
        />
      ) : null}
    </div>
  )
}
