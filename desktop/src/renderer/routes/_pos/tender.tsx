import { useEffect, useState } from 'react'
import { AppHeader } from '../../components/pos/app-header'
import { CartTotalsPanel } from '../../components/pos/cart-totals'
import { ManagerOverrideDialog } from '../../components/pos/manager-override-dialog'
import { Modal } from '../../components/pos/modal'
import { CashKeypad, NoPaymentDue } from '../../components/pos/tender-panel'
import type { PosConfigSnapshot } from '../../lib/api/types'
import { getBinding, type LocalStaffBinding } from '../../lib/auth/bindings'
import type { StaffSession } from '../../lib/auth/staff-session'
import { useCart } from '../../lib/cart/cart-store'
import {
  CREDIT_DECISION_MESSAGES,
  creditDecision,
  creditHeadroom,
  overLimitMinor,
} from '../../lib/credit/headroom'
import { useCustomerContext } from '../../lib/customers/context'
import { formatGhs } from '../../lib/format'
import { lockoutPolicyFor } from '../../lib/pos-config'
import type { OpenShiftSummary, PosIdentityRow } from '../../lib/pos-runtime'
import { usePosDatabase } from '../../lib/powersync/provider'
import { navigate } from '../../lib/router'
import { peekReceiptNumber } from '../../lib/sale/receipt-number'
import {
  buildSaleDraft,
  type SaleDraft,
  SaleDraftError,
  type TenderMethod,
} from '../../lib/sale/sale-draft'
import { usePosShortcuts } from '../../lib/shortcuts'

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
  const [binding, setBinding] = useState<LocalStaffBinding | null>(null)
  const [receiptNumber, setReceiptNumber] = useState('')
  const [showOverride, setShowOverride] = useState(false)
  const [draft, setDraft] = useState<SaleDraft | null>(null)
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
  }, [method])

  const decision = creditDecision({
    hasCustomer: Boolean(state.customer),
    snapshot: customerContext.credit,
    amountMinor: totalMinor,
  })

  const cashShort = method === 'CASH' && !zeroTotal && tendered < totalMinor
  const ready = Boolean(binding) && Boolean(shift) && Boolean(receiptNumber) && !cashShort

  function complete() {
    if (!shift) {
      setError('Open a shift before completing a sale')
      return
    }
    if (!binding) {
      setError('This terminal has no staff binding; sign in again')
      return
    }
    if (method === 'CREDIT' && decision !== 'OK' && !state.creditOverride) {
      setShowOverride(true)
      return
    }

    try {
      const saleDraft = buildSaleDraft({
        cart: state,
        totals,
        cashier: {
          userId: binding.userId,
          staffId: binding.staffId,
          bindingId: binding.bindingId,
          bindingToken: binding.bindingToken,
          pinVersion: binding.pinVersion,
        },
        shiftId: shift.id,
        receiptNumber,
        tender: {
          method,
          amountMinor: zeroTotal ? 0 : method === 'CASH' ? tendered : totalMinor,
          override: method === 'CREDIT' ? state.creditOverride : null,
        },
        occurredAt: new Date().toISOString(),
      })
      setDraft(saleDraft)
      setError(null)
    } catch (buildError) {
      setError(
        buildError instanceof SaleDraftError
          ? buildError.message
          : buildError instanceof Error
            ? buildError.message
            : 'The sale is not ready',
      )
    }
  }

  usePosShortcuts(
    {
      F9: complete,
      Escape: () => navigate('pos'),
    },
    !showOverride && !draft,
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
        <output
          role="alert"
          className="border-b border-destructive/40 bg-destructive/5 px-5 py-2 text-sm text-destructive"
        >
          {error}
          <button
            type="button"
            onClick={() => setError(null)}
            className="ml-3 rounded px-1.5 py-0.5 text-xs font-medium hover:bg-destructive/10"
          >
            Dismiss
          </button>
        </output>
      ) : null}

      <main className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-label="Payment" className="min-h-0 overflow-y-auto p-5">
          <div className="mb-4 flex items-end justify-between">
            <div>
              <h1 className="text-lg font-semibold">Tender</h1>
              <p className="text-sm text-muted-foreground">
                {totals.itemCount} item{totals.itemCount === 1 ? '' : 's'} ·{' '}
                {state.customer?.name ?? 'Walk-in'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground uppercase">Total due</p>
              <p className="font-mono text-3xl font-bold" data-testid="tender-total">
                {formatGhs(totalMinor)}
              </p>
            </div>
          </div>

          <fieldset className="mb-4 grid grid-cols-2 gap-2">
            <legend className="sr-only">Payment method</legend>
            <button
              type="button"
              onClick={() => setMethod('CASH')}
              aria-pressed={method === 'CASH'}
              className={`h-12 rounded-lg border text-sm font-semibold ${
                method === 'CASH'
                  ? 'border-foreground/40 bg-muted'
                  : 'border-border hover:bg-muted/60'
              }`}
              data-testid="method-cash"
            >
              Cash
            </button>
            <button
              type="button"
              onClick={() => setMethod('CREDIT')}
              disabled={!state.customer}
              aria-pressed={method === 'CREDIT'}
              title={state.customer ? undefined : 'A credit sale needs a customer'}
              className={`h-12 rounded-lg border text-sm font-semibold disabled:opacity-40 ${
                method === 'CREDIT'
                  ? 'border-foreground/40 bg-muted'
                  : 'border-border hover:bg-muted/60'
              }`}
              data-testid="method-credit"
            >
              Credit
            </button>
          </fieldset>

          {zeroTotal ? (
            <NoPaymentDue />
          ) : method === 'CASH' ? (
            <CashKeypad totalMinor={totalMinor} tenderedMinor={tendered} onChange={setTendered} />
          ) : (
            <div className="grid gap-3" data-testid="credit-tender">
              <div className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">Credit available</span>
                  <span className="font-mono text-lg font-semibold">
                    {formatGhs(creditHeadroom(customerContext.credit))}
                  </span>
                </div>
                <p
                  className={`mt-2 rounded px-2 py-1 text-xs font-medium ${
                    decision === 'OK'
                      ? 'bg-emerald-50 text-emerald-800'
                      : 'bg-amber-50 text-amber-900'
                  }`}
                  data-testid="credit-tender-decision"
                  data-decision={decision}
                >
                  {CREDIT_DECISION_MESSAGES[decision]}
                  {decision === 'OVER_LIMIT'
                    ? ` — over by ${formatGhs(overLimitMinor(customerContext.credit, totalMinor))}`
                    : ''}
                </p>

                {decision !== 'OK' ? (
                  state.creditOverride ? (
                    <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-900">
                      Approved by {state.creditOverride.approverStaffId} ·{' '}
                      {state.creditOverride.reasonCode}
                      <button
                        type="button"
                        onClick={() => dispatch({ type: 'setCreditOverride', override: null })}
                        className="ml-2 underline"
                      >
                        Remove
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowOverride(true)}
                      className="mt-2 h-10 w-full rounded-md border border-border text-sm font-medium hover:bg-muted"
                      data-testid="tender-request-approval"
                    >
                      Ask a manager
                    </button>
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
                <span className="font-mono" data-testid="tender-receipt">
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
            <button
              type="button"
              onClick={() => navigate('pos')}
              className="h-11 rounded-md border border-border text-sm font-medium hover:bg-muted"
              data-testid="back-to-cart"
            >
              Back to cart
            </button>
            <button
              type="button"
              onClick={complete}
              disabled={!ready}
              className="h-14 rounded-lg bg-primary text-base font-semibold text-primary-foreground disabled:opacity-40"
              data-testid="complete-sale"
            >
              Complete sale <span className="ml-1 text-xs font-normal opacity-70">F9</span>
            </button>
            {cashShort ? (
              <p className="text-center text-xs text-amber-700">
                Cash received is {formatGhs(totalMinor - tendered)} short of the total.
              </p>
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
            setError(
              'Continuing without approval — the server will record the over-limit conflict.',
            )
          }}
        />
      ) : null}

      {draft ? (
        <SaleReadyDialog
          draft={draft}
          onBackToCart={() => navigate('pos')}
          onClose={() => setDraft(null)}
        />
      ) : null}
    </div>
  )
}

/**
 * The hand-off. Plan 07 replaces the body copy with the commit + print flow;
 * the draft shown here is exactly what will be written.
 */
function SaleReadyDialog({
  draft,
  onClose,
  onBackToCart,
}: {
  draft: SaleDraft
  onClose: () => void
  onBackToCart: () => void
}) {
  const tender = draft.payload.tenders[0]
  return (
    <Modal
      title="Sale ready"
      description="The till has everything it needs to record this sale."
      onClose={onClose}
      testId="sale-draft-ready"
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 flex-1 rounded-md border border-border text-sm font-medium hover:bg-muted"
          >
            Keep editing
          </button>
          <button
            type="button"
            onClick={onBackToCart}
            className="h-10 flex-1 rounded-md bg-primary text-sm font-semibold text-primary-foreground"
          >
            Back to cart
          </button>
        </div>
      }
    >
      <div className="grid gap-1.5 text-sm">
        <Row label="Receipt" value={draft.payload.receiptNumber} />
        <Row
          label="Tender"
          value={
            draft.payload.tenders.length === 0
              ? 'No payment due'
              : `${tender?.method} ${formatGhs(tender?.amountMinor ?? 0)}`
          }
        />
        <Row label="Change" value={formatGhs(draft.payload.totals.changeMinor)} />
        <Row label="Total" value={formatGhs(draft.payload.totals.totalMinor)} />
        <Row
          label="Customer"
          value={
            draft.payload.customer
              ? (draft.payload.customer.name ?? 'Existing customer')
              : 'Walk-in'
          }
        />
        <Row label="Lines" value={String(draft.payload.lines.length)} />
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Recording the sale, printing the receipt, and opening the drawer are the next phase of this
        plan; the draft (including its idempotency key) is final.
      </p>
    </Modal>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-border py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  )
}
