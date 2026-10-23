import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AppHeader } from '../../components/pos/app-header'
import { CartLineRow } from '../../components/pos/cart-line'
import { CartTotalsPanel } from '../../components/pos/cart-totals'
import { CreditPanel } from '../../components/pos/credit-panel'
import { CustomerCreateDialog } from '../../components/pos/customer-create-dialog'
import { CustomerDialog } from '../../components/pos/customer-dialog'
import { CustomerPanel } from '../../components/pos/customer-panel'
import { DiscountDialog } from '../../components/pos/discount-dialog'
import { LoyaltyPanel } from '../../components/pos/loyalty-panel'
import { LoyaltyRedeemDialog } from '../../components/pos/loyalty-redeem-dialog'
import { ManagerOverrideDialog } from '../../components/pos/manager-override-dialog'
import { Modal } from '../../components/pos/modal'
import { ProductSearch } from '../../components/pos/product-search'
import { ScanListener } from '../../components/pos/scan-listener'
import type { PosConfigSnapshot } from '../../lib/api/types'
import { endStaffSession, type StaffSession } from '../../lib/auth/staff-session'
import { useCart } from '../../lib/cart/cart-store'
import { cartReducer } from '../../lib/cart/reducer'
import { computeCartTotals } from '../../lib/cart/totals'
import type { CartDiscount } from '../../lib/cart/types'
import { lookupScannedProduct } from '../../lib/catalog/resolve'
import { overLimitMinor } from '../../lib/credit/headroom'
import { useCustomerContext } from '../../lib/customers/context'
import type { CustomerHit } from '../../lib/customers/search'
import { discountAuthority } from '../../lib/discounts/discount-service'
import { formatGhs } from '../../lib/format'
import { lockoutPolicyFor } from '../../lib/pos-config'
import type { OpenShiftSummary, PosIdentityRow } from '../../lib/pos-runtime'
import { usePosDatabase } from '../../lib/powersync/provider'
import { navigate } from '../../lib/router'
import { usePosShortcuts } from '../../lib/shortcuts'

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
  const [showCreateCustomer, setShowCreateCustomer] = useState(false)
  const [showLoyalty, setShowLoyalty] = useState(false)
  const [showCreditOverride, setShowCreditOverride] = useState(false)
  const [discountTarget, setDiscountTarget] = useState<DiscountTarget | null>(null)
  const [pendingDiscount, setPendingDiscount] = useState<PendingDiscount | null>(null)
  const [showDiscountOverride, setShowDiscountOverride] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  const dialogOpen =
    confirmClear ||
    showCustomer ||
    showCreateCustomer ||
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
      <ScanListener onScan={handleScan} enabled={!dialogOpen} />
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
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="rounded px-2 py-0.5 text-xs font-medium hover:bg-amber-100"
          >
            Dismiss
          </button>
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
        <section aria-label="Catalog" className="flex min-h-0 flex-col border-r border-border p-4">
          <ProductSearch
            branchId={identity.branchId}
            focusRef={searchRef}
            onAdd={addProduct}
            onUnknown={(code) => setNotice(`No product for “${code}”.`)}
          />
        </section>

        <section aria-label="Cart" className="flex min-h-0 flex-col border-r border-border">
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h1 className="text-sm font-semibold">
              Current sale{' '}
              <span className="font-normal text-muted-foreground">{totals.itemCount} items</span>
            </h1>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                disabled={state.lines.length === 0}
                className="h-8 rounded-md border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {status === 'loading' ? (
              <p className="p-4 text-sm text-muted-foreground">Restoring the cart…</p>
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
            <button
              type="button"
              onClick={goTender}
              disabled={state.lines.length === 0}
              className="mt-3 h-14 w-full rounded-lg bg-primary text-base font-semibold text-primary-foreground disabled:opacity-40"
              data-testid="pay-button"
            >
              Pay {formatGhs(totals.priced.totalMinor)}{' '}
              <span className="ml-1 text-xs font-normal opacity-70">F9</span>
            </button>
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
              onFind={() => setShowCustomer(true)}
              onClear={() => setCustomer(null)}
            />
            <LoyaltyPanel
              customer={state.customer}
              loyalty={customerContext.loyalty}
              totals={totals}
              redeemPoints={state.loyaltyRedeemPoints}
              config={config.loyalty}
              onRedeem={() => setShowLoyalty(true)}
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

      {showCustomer ? (
        <CustomerDialog
          current={state.customer}
          onClose={() => setShowCustomer(false)}
          onSelect={applyCustomer}
          onCreate={() => {
            setShowCustomer(false)
            setShowCreateCustomer(true)
          }}
        />
      ) : null}

      {showCreateCustomer ? (
        <CustomerCreateDialog
          onClose={() => setShowCreateCustomer(false)}
          onCreated={(customer) => {
            applyCustomer(customer)
            setShowCreateCustomer(false)
          }}
        />
      ) : null}

      {showLoyalty ? (
        <LoyaltyRedeemDialog
          loyalty={customerContext.loyalty}
          config={config.loyalty}
          cartNetMinor={totals.priced.netMinor}
          cartTotalMinor={totals.priced.totalMinor}
          currentPoints={state.loyaltyRedeemPoints}
          preview={(points) => {
            const projected = computeCartTotals({ ...state, loyaltyRedeemPoints: points }, pricing)
            return {
              totalMinor: projected.priced.totalMinor,
              appliedMinor: projected.loyaltyDiscountMinor,
            }
          }}
          onClose={() => setShowLoyalty(false)}
          onConfirm={(points) => dispatch({ type: 'setLoyaltyRedeem', points })}
        />
      ) : null}

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
        <Modal
          title="Clear the sale?"
          description="The cart and its draft will be discarded."
          onClose={() => setConfirmClear(false)}
          testId="clear-cart-dialog"
          footer={
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="h-10 flex-1 rounded-md border border-border text-sm font-medium hover:bg-muted"
              >
                Keep cart
              </button>
              <button
                type="button"
                onClick={() => {
                  clear()
                  setSelectedLineId(null)
                  setConfirmClear(false)
                }}
                className="h-10 flex-1 rounded-md bg-destructive text-sm font-semibold text-destructive-foreground"
                data-testid="confirm-clear"
              >
                Clear sale
              </button>
            </div>
          }
        >
          <p className="text-sm text-muted-foreground">
            {totals.itemCount} item{totals.itemCount === 1 ? '' : 's'} worth{' '}
            {formatGhs(totals.priced.totalMinor)} will be removed.
          </p>
        </Modal>
      ) : null}
    </div>
  )
}
