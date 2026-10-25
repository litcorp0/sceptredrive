import { useEffect, useState } from 'react'
import { ManagerOverrideDialog, StatusNote } from '@/components/common'
import { AppHeader } from '@/components/layout'
import { Button } from '@/components/ui/button'
import type { PosConfigSnapshot } from '@/lib/api/types'
import { getBinding, type LocalStaffBinding } from '@/lib/auth/bindings'
import type { StaffSession } from '@/lib/auth/staff-session'
import { cartPricingContext, useCart } from '@/lib/cart/cart-store'
import { posRuntimeConfig } from '@/lib/config'
import {
  CREDIT_DECISION_MESSAGES,
  creditDecision,
  creditHeadroom,
  creditNeedsApproval,
  creditUsed,
  overLimitMinor,
} from '@/lib/credit/headroom'
import { useCustomerContext } from '@/lib/customers/context'
import { formatGhs } from '@/lib/format'
import { lockoutPolicyFor } from '@/lib/pos-config'
import type { OpenShiftSummary, PosIdentityRow } from '@/lib/pos-runtime'
import { usePosDatabase } from '@/lib/powersync/provider'
import { navigate } from '@/lib/router'
import { completeSale, SaleCompletionError } from '@/lib/sale/complete-sale'
import { peekReceiptNumber } from '@/lib/sale/document-sequence'
import type { TenderMethod } from '@/lib/sale/sale-draft'
import { usePosShortcuts } from '@/lib/shortcuts'
import { CartTotalsPanel } from '@/modules/cart'
import { CashKeypad, NoPaymentDue, TenderMethodToggle } from '../components/tender-panel'
import { appendPesewaDigit, removePesewaDigit } from '../utils/pesewa'

/**
 * Tender screen (Plan 06 Task 7).
 *
 * Cash or credit, then hand the sale draft to Plan 07, which writes it and
 * prints the receipt. Nothing here writes: the draft is pure data built from
 * the cart and the cashier's binding, so a cashier can back out at any point
 * and the cart is unchanged.
 *
 * A credit sale that needs a manager opens the override dialog instead of
 * silently completing — and that dialog always offers "continue without
 * approval", so the till never blocks (D17).
 *
 * Plan 07 of Phase 10 retuned it for counter distance: the total became muted
 * context so the change is the largest figure on the screen, the method pair
 * became a 44 px segmented control whose selected state survives colour
 * blindness, and the credit panel now states the limit, what is already owed,
 * and what is left — the three numbers a cashier is asked about.
 */
export function TenderScreen({
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
  const db = usePosDatabase()
  const { state, totals, dispatch } = useCart()
  const customerContext = useCustomerContext(state.customer, identity.branchId)

  const totalMinor = totals.priced.totalMinor
  const zeroTotal = totalMinor === 0

  const [method, setMethod] = useState<TenderMethod>('CASH')
  const [tendered, setTendered] = useState(0)
  // A cashier who chooses "Continue without approval" proceeds with the sale;
  // the server records CREDIT_OVER_LIMIT/CREDIT_HOLD for manager review (D17:
  // the till never blocks). Without this flag the override dialog would reopen
  // forever because a bypass stores `creditOverride: null`.
  const [creditBypass, setCreditBypass] = useState(false)
  const [binding, setBinding] = useState<LocalStaffBinding | null>(null)
  const [receiptNumber, setReceiptNumber] = useState('')
  const [showOverride, setShowOverride] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getBinding(db, staff.bindingId).then((row) => {
      if (!cancelled) setBinding(row)
    })
    return () => {
      cancelled = true
    }
  }, [db, staff.bindingId])

  useEffect(() => {
    let cancelled = false
    void peekReceiptNumber(db, identity.terminalId, identity.terminalCode).then((number) => {
      if (!cancelled) setReceiptNumber(number)
    })
    return () => {
      cancelled = true
    }
  }, [db, identity.terminalId, identity.terminalCode])

  useEffect(() => {
    setTendered(0)
    setError(null)
    setCreditBypass(false)
  }, [method])

  // A different customer invalidates both an approval and a bypass.
  const customerKey = state.customer?.customerId ?? state.customer?.draftId ?? ''
  useEffect(() => {
    setCreditBypass(false)
  }, [customerKey])

  const decision = creditDecision({
    hasCustomer: Boolean(state.customer),
    snapshot: customerContext.credit,
    amountMinor: totalMinor,
  })

  // The local read of the credit profile is asynchronous. Until it answers, "no account here"
  // and "not looked yet" are indistinguishable, and acting on the first would offer a manager
  // override to a customer who has a limit (Plan 09's audit found exactly that).
  const creditChecking = method === 'CREDIT' && customerContext.creditLoading

  const cashShort = method === 'CASH' && !zeroTotal && tendered < totalMinor
  const ready =
    Boolean(binding) && Boolean(shift) && Boolean(receiptNumber) && !cashShort && !creditChecking

  function complete() {
    if (completing) return
    if (!shift) {
      setError('Open a shift before completing a sale')
      return
    }
    if (!binding) {
      setError('This terminal has no staff binding; sign in again')
      return
    }
    if (creditChecking) {
      setError('Still checking this customer’s credit account. Press Complete again.')
      return
    }
    if (
      creditNeedsApproval({
        method,
        decision,
        hasOverride: Boolean(state.creditOverride),
        bypassed: creditBypass,
      })
    ) {
      setShowOverride(true)
      return
    }

    setCompleting(true)
    setError(null)

    void completeSale(db, {
      cart: state,
      tender: {
        method,
        amountMinor: zeroTotal ? 0 : method === 'CASH' ? tendered : totalMinor,
      },
      cashier: {
        userId: binding.userId,
        staffId: binding.staffId,
        bindingId: binding.bindingId,
        bindingToken: binding.bindingToken,
        pinVersion: binding.pinVersion,
      },
      identity,
      pricing: cartPricingContext(config),
      appVersion: posRuntimeConfig.appVersion,
    })
      .then((result) => {
        // The local transaction already cleared the stored draft. Clearing the
        // in-memory cart means returning to #pos starts a fresh sale.
        dispatch({ type: 'clear' })
        navigate(`pos/receipt/${result.saleId}`)
      })
      .catch((completionError: unknown) => {
        setCompleting(false)
        setError(
          completionError instanceof SaleCompletionError
            ? completionError.message
            : completionError instanceof Error
              ? completionError.message
              : 'The sale could not be completed',
        )
      })
  }

  /*
   * The number row types the amount. A till has a keyboard as well as a screen, and until Plan
   * 09's audit the cashier had to Tab to the on-screen keys to enter cash. The digit model is
   * the keypad's own (`appendPesewaDigit`), so typing and tapping cannot disagree, and the
   * shortcut layer already ignores printable keys while a field has focus.
   */
  const cashEntry = method === 'CASH' && !zeroTotal
  const digitHandlers = Object.fromEntries(
    [...'0123456789'].map((digit) => [
      digit,
      () => {
        if (!cashEntry) return
        setTendered((current) => appendPesewaDigit(current, digit))
      },
    ]),
  )

  usePosShortcuts(
    {
      ...digitHandlers,
      Backspace: () => {
        if (!cashEntry) return
        setTendered((current) => removePesewaDigit(current))
      },
      F9: complete,
      Escape: () => navigate('pos'),
    },
    !showOverride && !completing,
  )

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <AppHeader
        identity={identity}
        shift={shift}
        staff={staff}
        onLock={() => navigate('pos')}
        lockNote="Back to the sale"
      />

      {error ? (
        <StatusNote
          tone="danger"
          role="alert"
          className="rounded-none border-x-0 border-t-0 px-5 py-1.5 text-sm"
          action={
            <Button
              type="button"
              variant="ghost"
              onClick={() => setError(null)}
              className="h-11 min-w-11 px-2 text-xs text-foreground hover:bg-foreground/5"
            >
              Dismiss
            </Button>
          }
        >
          {error}
        </StatusNote>
      ) : null}

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Payment" className="min-h-0 overflow-y-auto p-5">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="text-lg font-semibold">Tender</h1>
              <p className="text-sm text-muted-foreground">
                {totals.itemCount} item{totals.itemCount === 1 ? '' : 's'} ·{' '}
                {state.customer?.name ?? 'Walk-in'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase">Total due</p>
              <p
                className="font-mono text-lg text-muted-foreground tabular-nums"
                data-testid="tender-total"
              >
                {formatGhs(totalMinor)}
              </p>
            </div>
          </div>

          <TenderMethodToggle
            method={method}
            onChange={setMethod}
            creditDisabled={!state.customer}
          />
          {state.customer ? null : (
            <p className="mb-4 text-xs text-muted-foreground">
              A credit sale needs a customer. Choose one on the sale screen.
            </p>
          )}

          {zeroTotal ? (
            <NoPaymentDue />
          ) : method === 'CASH' ? (
            <CashKeypad totalMinor={totalMinor} tenderedMinor={tendered} onChange={setTendered} />
          ) : (
            <div className="grid gap-3" data-testid="credit-tender">
              <div className="rounded-lg border border-border bg-card p-4">
                <dl className="grid gap-1">
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-xs text-muted-foreground">Credit limit</dt>
                    <dd className="font-mono text-sm tabular-nums">
                      {formatGhs(customerContext.credit.limitMinor)}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-xs text-muted-foreground">Owed at this branch</dt>
                    <dd className="font-mono text-sm tabular-nums">
                      {formatGhs(creditUsed(customerContext.credit))}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4 border-t border-border pt-1">
                    <dt className="text-xs font-medium text-muted-foreground">Available</dt>
                    <dd
                      className="font-mono text-lg font-semibold tabular-nums"
                      data-testid="credit-available"
                    >
                      {formatGhs(creditHeadroom(customerContext.credit))}
                    </dd>
                  </div>
                </dl>

                {creditChecking ? (
                  <StatusNote tone="info" role="status" className="mt-2">
                    Checking this customer’s credit account…
                  </StatusNote>
                ) : (
                  <StatusNote
                    tone={decision === 'OK' ? 'ok' : 'notice'}
                    className="mt-2"
                    data-testid="credit-tender-decision"
                    data-decision={decision}
                  >
                    {CREDIT_DECISION_MESSAGES[decision]}
                    {decision === 'OVER_LIMIT'
                      ? ` — over by ${formatGhs(overLimitMinor(customerContext.credit, totalMinor))}`
                      : ''}
                    {decision !== 'OK' ? ' A manager can approve it.' : ''}
                  </StatusNote>
                )}

                {decision !== 'OK' ? (
                  state.creditOverride ? (
                    <StatusNote tone="ok" className="mt-2">
                      Approved by {state.creditOverride.approverStaffId} ·{' '}
                      {state.creditOverride.reasonCode}
                      <Button
                        type="button"
                        variant="link"
                        onClick={() => dispatch({ type: 'setCreditOverride', override: null })}
                        className="ml-1 h-11 px-2 text-xs text-foreground"
                      >
                        Remove
                      </Button>
                    </StatusNote>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setShowOverride(true)}
                      className="mt-2 h-11 w-full"
                      data-testid="tender-request-approval"
                    >
                      Ask a manager
                    </Button>
                  )
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                The full total is charged to the customer's account at this branch. The debt is
                recorded even if the limit is exceeded — a manager conflict is raised for review.
              </p>
            </div>
          )}
        </section>

        <aside aria-label="Sale summary" className="flex min-h-0 flex-col border-l border-border">
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            <CartTotalsPanel totals={totals} />
            <div className="mt-3 grid gap-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground">Receipt</span>
                <span className="font-mono tabular-nums" data-testid="tender-receipt">
                  {receiptNumber || '—'}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-muted-foreground">Cashier</span>
                <span className="font-mono">{staff.staffId}</span>
              </div>
            </div>
          </div>

          <div className="grid gap-2 border-t border-border p-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate('pos')}
              className="h-11"
              data-testid="back-to-cart"
            >
              Back to cart
            </Button>
            <Button
              type="button"
              onClick={complete}
              disabled={!ready || completing}
              className="h-14 text-base"
              data-testid="complete-sale"
            >
              {completing ? 'Recording sale…' : 'Complete sale'}{' '}
              <span className="ml-1 font-mono text-xs font-normal tabular-nums opacity-70">F9</span>
            </Button>
            {cashShort ? (
              <StatusNote tone="notice" role="status">
                Cash received is {formatGhs(totalMinor - tendered)} short of the total.
              </StatusNote>
            ) : null}
          </div>
        </aside>
      </main>

      {showOverride ? (
        <ManagerOverrideDialog
          title="Credit approval"
          description="A manager approves selling on credit beyond the limit or on a held account."
          permission="credit.override"
          amountMinor={totalMinor}
          overByMinor={overLimitMinor(customerContext.credit, totalMinor)}
          policy={lockoutPolicyFor(config)}
          onClose={() => setShowOverride(false)}
          onApproved={(proof) => {
            dispatch({ type: 'setCreditOverride', override: proof })
            setError(null)
          }}
          onBypass={() => {
            dispatch({ type: 'setCreditOverride', override: null })
            setCreditBypass(true)
            setError(
              'Continuing without approval — the server will record the over-limit conflict.',
            )
          }}
        />
      ) : null}
    </div>
  )
}
