import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ManagerOverrideDialog, useDialogFocusReturn } from '@/components/common'
import { AppHeader } from '@/components/layout'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import type { PosConfigSnapshot } from '@/lib/api/types'
import { endStaffSession, type StaffSession } from '@/lib/auth/staff-session'
import { useCart } from '@/lib/cart/cart-store'
import { cartReducer } from '@/lib/cart/reducer'
import { computeCartTotals } from '@/lib/cart/totals'
import type { CartDiscount } from '@/lib/cart/types'
import { lookupScannedProduct } from '@/lib/catalog/resolve'
import { overLimitMinor } from '@/lib/credit/headroom'
import { useCustomerContext } from '@/lib/customers/context'
import type { CustomerHit } from '@/lib/customers/search'
import { discountAuthority } from '@/lib/discounts/discount-service'
import { formatGhs } from '@/lib/format'
import { lockoutPolicyFor } from '@/lib/pos-config'
import type { OpenShiftSummary, PosIdentityRow } from '@/lib/pos-runtime'
import { usePosDatabase } from '@/lib/powersync/provider'
import { navigate } from '@/lib/router'
import { usePosShortcuts } from '@/lib/shortcuts'
import { CartLineRow, CartTotalsPanel } from '@/modules/cart'
import { CatalogBrowser } from '@/modules/catalog'
import { CreditPanel } from '@/modules/credit'
import { CustomerPanel } from '@/modules/customers'
import { LoyaltyPanel } from '@/modules/loyalty'
import { DiscountDialog } from '../components/discount-dialog'

/**
 * The selling screen (Plan 06).
 *
 * Three columns, left to right: what you are adding, what you have added, and
 * who it is for. A counter screen is glanceable and touchable: large targets,
 * no hover-only controls, and the total always visible.
 *
 * Tasks 2–6 fill the catalogue, customer, loyalty, credit, and discount
 * panels; this file owns the layout, the cart, the keyboard map, and the
 * hand-off to the tender screen.
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
  const { state, totals, pricing, dispatch, clear, status, error, addProduct, setCustomer } =
    useCart()
  const db = usePosDatabase()
  const customerContext = useCustomerContext(state.customer, identity.branchId)
  const [selectedLineId, setSelectedLineId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [showCustomer, setShowCustomer] = useState(false)
  const [showLoyalty, setShowLoyalty] = useState(false)
  const [showCreditOverride, setShowCreditOverride] = useState(false)
  const [discountTarget, setDiscountTarget] = useState<DiscountTarget | null>(null)
  const [pendingDiscount, setPendingDiscount] = useState<PendingDiscount | null>(null)
  const [showDiscountOverride, setShowDiscountOverride] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const dialogOpen =
    confirmClear ||
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
    if (!shift) {
      setNotice('Open a shift before completing a sale')
      return
    }
    navigate('pos/tender')
  }, [state.lines.length, shift])

  type DiscountTarget = { kind: 'sale' } | { kind: 'line'; lineId: string }
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

  usePosShortcuts(
    useMemo(
      () => ({
        F2: () => searchRef.current?.focus(),
        F4: () => setShowCustomer(true),
        F6: () => {
          if (!state.customer) {
            setNotice('Choose a customer before redeeming points')
            return
          }
          setShowLoyalty(true)
        },
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
      [goTender, selectedLine, selectedLineId, setQuantity, state.customer, state.lines],
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
        <output className="flex items-center justify-between gap-4 border-b border-amber-300 bg-amber-50 px-5 py-2 text-sm text-amber-900">
          <span>{notice}</span>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setNotice(null)}
            className="h-11 px-2 text-xs hover:bg-amber-100"
          >
            Dismiss
          </Button>
        </output>
      ) : null}

      {error ? (
        <div
          role="alert"
          className="border-b border-destructive/40 bg-destructive/5 px-5 py-2 text-sm text-destructive"
        >
          {error}
        </div>
      ) : null}

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(360px,440px)_280px]">
        <CatalogBrowser
          branchId={identity.branchId}
          focusRef={searchRef}
          scanEnabled={!dialogOpen}
          onAdd={addProduct}
          onUnknown={(code) => setNotice(`No product for “${code}”.`)}
          onScan={handleScan}
        />

        <section aria-label="Cart" className="flex min-h-0 flex-col border-r border-border">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h1 className="text-sm font-semibold">
              Current sale{' '}
              <span className="font-normal text-muted-foreground">{totals.itemCount} items</span>
            </h1>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfirmClear(true)}
                disabled={state.lines.length === 0}
                className="h-11 px-3"
              >
                Clear
              </Button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {status === 'loading' ? (
              <div className="grid gap-2 p-1">
                <span className="sr-only">Restoring the cart…</span>
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
                <Skeleton className="h-14 w-full" />
              </div>
            ) : state.lines.length === 0 ? (
              <div className="flex h-full items-center justify-center p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  Scan a barcode or search for a product to start the sale.
                </p>
              </div>
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
              disabled={state.lines.length === 0}
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
          className="hidden min-h-0 overflow-y-auto lg:block"
        >
          <div className="grid gap-3 p-3">
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

      {confirmClear ? (
        <ClearCartDialog
          itemCount={totals.itemCount}
          totalMinor={totals.priced.totalMinor}
          onClose={() => setConfirmClear(false)}
          onConfirm={() => {
            clear()
            setSelectedLineId(null)
            setConfirmClear(false)
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * The clear-the-sale confirmation.
 *
 * Its own component so `useDialogFocusReturn` captures the Clear button when the
 * dialog mounts, not the selling page when it first rendered. `Dialog` has no
 * trigger here — the flag above owns the open state — so the hook is what
 * returns focus.
 */
function ClearCartDialog({
  itemCount,
  totalMinor,
  onClose,
  onConfirm,
}: {
  itemCount: number
  totalMinor: number
  onClose: () => void
  onConfirm: () => void
}) {
  const focusReturn = useDialogFocusReturn()

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        {...focusReturn}
        data-testid="clear-cart-dialog"
        className="flex max-h-[90vh] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <DialogHeader className="border-b border-border px-5 py-4 pr-16">
          <DialogTitle className="text-base">Clear the sale?</DialogTitle>
          <DialogDescription>The cart and its draft will be discarded.</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="text-sm text-muted-foreground">
            {itemCount} item{itemCount === 1 ? '' : 's'} worth {formatGhs(totalMinor)} will be
            removed.
          </p>
        </div>

        <DialogFooter className="border-t border-border px-5 py-3">
          <div className="flex w-full gap-2">
            <Button type="button" variant="outline" onClick={onClose} className="h-11 flex-1">
              Keep cart
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onConfirm}
              className="h-11 flex-1"
              data-testid="confirm-clear"
            >
              Clear sale
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
