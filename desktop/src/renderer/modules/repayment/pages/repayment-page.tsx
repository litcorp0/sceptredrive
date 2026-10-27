import { useEffect, useMemo, useState } from 'react'
import { ManagerOverrideDialog, ScreenHeader, StatusNote } from '@/components/common'
import { AppHeader } from '@/components/layout'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PaymentClientError, type PaymentView, paymentsClient } from '@/lib/api/payments-client'
import type { StaffSession } from '@/lib/auth/staff-session'
import type { CartOverrideProof } from '@/lib/cart/types'
import { searchCustomers } from '@/lib/customers/search'
import { formatGhs } from '@/lib/format'
import { uuidv7 } from '@/lib/id'
import { lockoutPolicyFor } from '@/lib/pos-config'
import type { OpenShiftSummary, PosIdentityRow } from '@/lib/pos-runtime'
import { usePosRuntime } from '@/lib/pos-runtime'
import { usePos } from '@/lib/powersync/provider'
import { printRepayment } from '@/lib/printing/print-sale'
import { desktopPrinterTransport } from '@/lib/printing/printer-service'
import { loadPrinterSettings } from '@/lib/printing/settings'
import {
  buildRepaymentReceiptModel,
  type ReceiptContext,
  type RepaymentReceiptModel,
  repaymentReceiptToText,
} from '@/lib/receipt/render'
import { reconcileLocalDeltas } from '@/lib/refund/local-deltas'
import {
  type CreditAccount,
  createRepayment,
  type RepaymentMethod,
  type RepaymentPaymentProof,
  type RepaymentResult,
  readCreditAccount,
} from '@/lib/refund/repayment-service'
import { navigate } from '@/lib/router'
import { readCashierName, readReceiptContext } from '@/lib/sale/sale-repository'

/**
 * The same pesewa digit rule the tender keypad uses, kept local because a
 * module may only be imported through its barrel (`@/modules/tender` does not
 * export its utils). Nine digits, leading zeros dropped: 500 shows GH₵5.00.
 */
function appendDigit(minor: number, digit: string): number {
  if (!/^\d$/.test(digit)) return minor
  const next = `${minor}${digit}`.replace(/^0+(?=\d)/, '')
  return next.length > 9 ? minor : Number(next)
}

function dropDigit(minor: number): number {
  return Math.floor(minor / 10)
}

/**
 * Taking a credit repayment at the till (Plan 10 Task 5; P13-D27).
 *
 * Cash works offline; MoMo needs the network and the server's `PAID`. The write
 * is one local transaction that posts a negative `local_credit_delta` and a
 * `CREDIT_REPAYMENT` outbox row, so the headroom shown here drops immediately.
 * A profile on hold needs a manager's `credit.override`: taking money against a
 * hold is how a hold gets quietly bypassed.
 */

interface CustomerHit {
  customerId: string | null
  draftId: string | null
  name: string
  phone: string
  isDraft: boolean
}

const QUICK_AMOUNTS_MINOR = [2_000, 5_000, 10_000, 20_000, 50_000]
const MOMO_POLL_MS = 3_000
const MOMO_PROVIDERS = [
  { value: 'mtn', label: 'MTN MoMo' },
  { value: 'vod', label: 'Telecel Cash' },
  { value: 'atl', label: 'AirtelTigo Money' },
] as const

export function RepaymentScreen({
  identity,
  shift,
  staff,
}: {
  identity: PosIdentityRow
  shift: OpenShiftSummary | null
  staff: StaffSession
}) {
  const { db } = usePos()
  const runtime = usePosRuntime()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<CustomerHit[] | null>(null)
  const [account, setAccount] = useState<CreditAccount | null>(null)
  const [amountMinor, setAmountMinor] = useState(0)
  const [method, setMethod] = useState<RepaymentMethod>('CASH')
  const [momoProvider, setMomoProvider] = useState<'mtn' | 'vod' | 'atl'>('mtn')
  const [momoPhone, setMomoPhone] = useState('')
  const [payment, setPayment] = useState<PaymentView | null>(null)
  const [showOverride, setShowOverride] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<RepaymentResult | null>(null)
  const [receipt, setReceipt] = useState<RepaymentReceiptModel | null>(null)
  const [printMessage, setPrintMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!db) return
    // A repayment's delta and a refund's stock return stop counting once their
    // upload acks; this is the in-lane reconcile for those two outbox types.
    void reconcileLocalDeltas(db)
  }, [db])

  async function search(): Promise<void> {
    if (!db || !query.trim()) return
    setError(null)
    const found = await searchCustomers(db, query)
    setHits(found.filter((hit) => hit.customerId).map((hit) => hit as CustomerHit))
  }

  async function choose(hit: CustomerHit): Promise<void> {
    if (!db || !hit.customerId) return
    setError(null)
    setPayment(null)
    setMessage(null)
    const loaded = await readCreditAccount(db, hit.customerId, identity.branchId)
    if (!loaded) {
      setError('That customer is not on this terminal')
      return
    }
    setAccount(loaded)
    setAmountMinor(0)
    setMomoPhone(loaded.phone)
  }

  const paymentProof = useMemo<RepaymentPaymentProof | null>(() => {
    if (method !== 'MOMO' || !payment) return null
    return {
      id: payment.id,
      status: payment.status,
      method: payment.method,
      amountMinor: payment.amountMinor,
    }
  }, [method, payment])

  // Poll the server's payment while a MoMo charge is in flight (Plan 09 client).
  useEffect(() => {
    if (!payment || payment.status !== 'PENDING') return
    let cancelled = false
    const timer = setInterval(() => {
      void paymentsClient
        .get(payment.id, { refresh: true })
        .then((next) => {
          if (cancelled) return
          setPayment(next)
          if (next.status === 'PAID') setMessage('MoMo payment received. Record the repayment.')
          if (
            next.status === 'FAILED' ||
            next.status === 'EXPIRED' ||
            next.status === 'ABANDONED'
          ) {
            setMessage(
              next.failedMessage ?? 'The MoMo payment did not complete. Try again or take cash.',
            )
          }
        })
        .catch(() => {
          if (!cancelled) setMessage('Still waiting for the payment network…')
        })
    }, MOMO_POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [payment])

  async function takeMomoPayment(): Promise<void> {
    if (!account) return
    if (amountMinor < 1) {
      setError('Enter the amount received')
      return
    }
    setBusy(true)
    setError(null)
    setMessage(null)
    try {
      const created = await paymentsClient.create({
        clientPaymentId: uuidv7(),
        method: 'MOMO',
        amountMinor,
        shiftId: shift?.id ?? '',
        mobileMoney: { provider: momoProvider, phone: momoPhone },
      })
      setPayment(created)
      setMessage(created.displayText ?? 'Approve the payment on the customer’s phone.')
    } catch (cause) {
      setError(
        cause instanceof PaymentClientError && cause.retryable
          ? 'The payment network cannot be reached. Take cash, or try MoMo when the network is back.'
          : cause instanceof Error
            ? cause.message
            : 'The MoMo payment could not be started',
      )
    } finally {
      setBusy(false)
    }
  }

  async function writeRepayment(override: CartOverrideProof | null): Promise<void> {
    if (!db || !account) return
    setBusy(true)
    setError(null)
    try {
      const result = await createRepayment(db, {
        customerId: account.customerId,
        amountMinor,
        method,
        payment: method === 'MOMO' ? paymentProof : null,
        override,
      })
      setDone(result)
      await printResult(db, result)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The repayment could not be written')
    } finally {
      setBusy(false)
    }
  }

  async function printResult(
    database: NonNullable<typeof db>,
    result: RepaymentResult,
  ): Promise<void> {
    if (!account) return
    try {
      const [context, cashierName, settings] = await Promise.all([
        readReceiptContext(database),
        readCashierName(database, staff.staffId),
        loadPrinterSettings(database),
      ])
      const model = buildRepaymentReceiptModel({
        context: (context ?? {
          branchName: identity.branchName,
          branchCode: identity.branchCode,
          terminalCode: identity.terminalCode,
        }) as ReceiptContext,
        number: result.number,
        occurredAt: result.occurredAt,
        cashierName,
        customerName: account.name,
        customerPhone: account.phone,
        method: result.method,
        amountMinor: result.amountMinor,
        balanceBeforeMinor: account.projectedBalanceMinor,
        balanceAfterMinor: result.projectedBalanceMinor,
        limitMinor: result.limitMinor,
        headroomMinor: result.headroomMinor,
      })
      setReceipt(model)
      const outcome = await printRepayment({ transport: desktopPrinterTransport, settings }, model)
      setPrintMessage(
        outcome.ok ? 'Printed' : 'The repayment is saved; the receipt could not be printed.',
      )
    } catch (cause) {
      setPrintMessage(
        cause instanceof Error
          ? cause.message
          : 'The repayment is saved; the receipt could not be printed.',
      )
    }
  }

  function confirm(): void {
    if (!account) return
    if (!shift) {
      setError('Open a shift before taking money')
      return
    }
    if (amountMinor < 1) {
      setError('Enter the amount received')
      return
    }
    if (method === 'MOMO' && paymentProof?.status !== 'PAID') {
      setError('Wait for the MoMo payment to settle before recording it')
      return
    }
    if (account.snapshot.hold) {
      setShowOverride(true)
      return
    }
    void writeRepayment(null)
  }

  if (done && receipt) {
    return (
      <div className="min-h-screen bg-background text-foreground">
        <AppHeader
          identity={identity}
          shift={shift}
          staff={staff}
          onLock={() => navigate('home')}
          lockNote="Back to today"
        />
        <main className="mx-auto grid max-w-5xl gap-6 p-6 md:grid-cols-[minmax(0,1fr)_320px]">
          <pre
            className="overflow-x-auto rounded-lg border border-border bg-white p-4 font-mono text-[11px] text-black"
            data-testid="repayment-receipt"
          >
            {repaymentReceiptToText(receipt, { columns: 42 })}
          </pre>
          <aside className="grid content-start gap-3">
            <StatusNote tone="ok" role="status">
              {formatGhs(done.amountMinor)} received. Available credit is now{' '}
              {formatGhs(done.headroomMinor)}.
            </StatusNote>
            {printMessage ? (
              <StatusNote tone="info" role="status">
                {printMessage}
              </StatusNote>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => {
                setDone(null)
                setAccount(null)
                setHits(null)
                setQuery('')
                setAmountMinor(0)
                setPayment(null)
              }}
            >
              Take another repayment
            </Button>
            <Button type="button" className="h-14 text-sm" onClick={() => navigate('home')}>
              Done
            </Button>
          </aside>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader
        identity={identity}
        shift={shift}
        staff={staff}
        onLock={() => navigate('home')}
        lockNote="Back to today"
      />
      <main className="mx-auto max-w-4xl p-6">
        <ScreenHeader
          title="Take a credit repayment"
          description="Money against a customer’s account. Cash works offline; MoMo needs the network."
          actions={
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => navigate('home')}
            >
              Back to today
            </Button>
          }
        />

        {error ? (
          <StatusNote tone="danger" role="alert" className="mb-4">
            {error}
          </StatusNote>
        ) : null}

        {!shift ? (
          <StatusNote tone="notice" role="status" className="mb-4">
            Open a shift before taking money: the repayment belongs to this drawer.
          </StatusNote>
        ) : null}

        <Card className="gap-3 py-4">
          <form
            className="flex flex-wrap items-end gap-3 px-4"
            onSubmit={(event) => {
              event.preventDefault()
              void search()
            }}
          >
            <div className="grid min-w-64 flex-1 gap-1.5">
              <Label htmlFor="repayment-customer">Customer name or phone</Label>
              <Input
                id="repayment-customer"
                data-testid="repayment-search"
                value={query}
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Akosua Mensah or 024 123 4567"
                className="h-12"
              />
            </div>
            <Button type="submit" className="h-12 px-5">
              Find customer
            </Button>
          </form>

          {hits ? (
            hits.length === 0 ? (
              <p className="px-4 text-sm text-muted-foreground">No customer matches that.</p>
            ) : (
              <ul className="grid gap-1 px-4" data-testid="repayment-results">
                {hits.map((hit) => (
                  <li key={hit.customerId ?? hit.phone}>
                    <button
                      type="button"
                      onClick={() => void choose(hit)}
                      className="flex w-full items-baseline justify-between gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <span>{hit.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">{hit.phone}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : null}
        </Card>

        {account ? (
          <div className="mt-4 grid gap-4">
            <Card className="gap-3 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3 px-4">
                <div>
                  <p className="font-medium">{account.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{account.phone}</p>
                </div>
                {account.snapshot.hold ? (
                  <Badge
                    className="gap-1.5 border-transparent bg-warn/15 text-foreground"
                    data-testid="credit-hold"
                  >
                    <span aria-hidden="true" className="size-1.5 rounded-full bg-warn" />
                    On hold
                  </Badge>
                ) : null}
              </div>
              <dl className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-4">
                <div>
                  <dt className="text-[11px] text-muted-foreground uppercase">Limit</dt>
                  <dd className="font-mono text-sm tabular-nums">
                    {formatGhs(account.snapshot.limitMinor)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground uppercase">Balance</dt>
                  <dd className="font-mono text-sm tabular-nums" data-testid="credit-balance">
                    {formatGhs(account.projectedBalanceMinor)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground uppercase">Available</dt>
                  <dd className="font-mono text-sm tabular-nums" data-testid="credit-headroom">
                    {formatGhs(account.headroomMinor)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground uppercase">Method</dt>
                  <dd className="text-sm">Cash or MoMo</dd>
                </div>
              </dl>
              {account.snapshot.hold ? (
                <StatusNote tone="notice" className="mx-4">
                  This account is on hold — a manager must approve taking money.
                </StatusNote>
              ) : null}
            </Card>

            <section aria-label="Amount received" className="rounded-lg border border-border p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm text-muted-foreground">Received</span>
                <span
                  className="font-display text-3xl font-semibold tabular-nums"
                  data-testid="repayment-amount"
                >
                  {formatGhs(amountMinor)}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={() => setAmountMinor(account.projectedBalanceMinor)}
                >
                  Full balance
                </Button>
                {QUICK_AMOUNTS_MINOR.map((note) => (
                  <Button
                    key={note}
                    type="button"
                    variant="outline"
                    className="h-11 font-mono tabular-nums"
                    onClick={() => setAmountMinor((current) => current + note)}
                  >
                    +{formatGhs(note)}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  className="h-11"
                  onClick={() => setAmountMinor(0)}
                >
                  Clear
                </Button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                  <Button
                    key={digit}
                    type="button"
                    variant="outline"
                    className="h-12 bg-card text-lg font-semibold"
                    aria-label={`Digit ${digit}`}
                    onClick={() => setAmountMinor((current) => appendDigit(current, digit))}
                  >
                    {digit}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 bg-card text-lg font-semibold"
                  aria-label="Digit 0"
                  onClick={() => setAmountMinor((current) => appendDigit(current, '0'))}
                >
                  0
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 bg-card"
                  aria-label="Backspace"
                  onClick={() => setAmountMinor((current) => dropDigit(current))}
                >
                  ⌫
                </Button>
              </div>
            </section>

            <section aria-label="Method" className="rounded-lg border border-border p-4">
              <ToggleGroup
                type="single"
                variant="outline"
                value={method}
                onValueChange={(value) => {
                  if (!value) return
                  setMethod(value as RepaymentMethod)
                  setPayment(null)
                  setMessage(null)
                }}
                aria-label="Repayment method"
                className="flex w-full flex-wrap"
              >
                <ToggleGroupItem
                  value="CASH"
                  className="h-12 flex-1 text-sm font-semibold data-[state=on]:border-2 data-[state=on]:border-foreground"
                  data-testid="repayment-cash"
                >
                  Cash
                </ToggleGroupItem>
                <ToggleGroupItem
                  value="MOMO"
                  className="h-12 flex-1 text-sm font-semibold data-[state=on]:border-2 data-[state=on]:border-foreground"
                  data-testid="repayment-momo"
                >
                  MoMo
                </ToggleGroupItem>
              </ToggleGroup>

              {method === 'MOMO' ? (
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
                  <div className="grid gap-1.5">
                    <Label htmlFor="repayment-network">Network</Label>
                    <select
                      id="repayment-network"
                      value={momoProvider}
                      onChange={(event) =>
                        setMomoProvider(event.target.value as 'mtn' | 'vod' | 'atl')
                      }
                      className="h-11 rounded-md border border-border bg-background px-3 text-sm"
                    >
                      {MOMO_PROVIDERS.map((provider) => (
                        <option key={provider.value} value={provider.value}>
                          {provider.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="repayment-phone">Phone</Label>
                    <Input
                      id="repayment-phone"
                      value={momoPhone}
                      onChange={(event) => setMomoPhone(event.target.value)}
                      inputMode="tel"
                      className="h-11"
                    />
                  </div>
                  <Button
                    type="button"
                    className="h-11"
                    disabled={busy || !shift || payment?.status === 'PENDING'}
                    onClick={() => void takeMomoPayment()}
                    data-testid="repayment-send-momo"
                  >
                    {payment?.status === 'PENDING' ? 'Waiting…' : 'Send request'}
                  </Button>
                </div>
              ) : null}

              {message ? (
                <StatusNote tone="info" role="status" className="mt-3">
                  {message}
                </StatusNote>
              ) : null}
              {payment ? (
                <p
                  className="mt-2 text-xs text-muted-foreground"
                  data-testid="repayment-payment-status"
                >
                  MoMo payment {payment.status.toLowerCase()} · {formatGhs(payment.amountMinor)}
                </p>
              ) : null}
            </section>

            <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium">
                  Record {formatGhs(amountMinor)} against {account.name}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  Cash needs no PIN. A held account needs a manager.
                </p>
              </div>
              <Button
                type="button"
                className="h-14 px-6 text-sm"
                disabled={busy || amountMinor < 1}
                onClick={confirm}
                data-testid="record-repayment"
              >
                {busy ? 'Writing…' : 'Record repayment'}
              </Button>
            </section>
          </div>
        ) : (
          <p className="mt-6 text-sm text-muted-foreground" data-testid="repayment-empty">
            Search for the customer whose account is being paid down.
          </p>
        )}
      </main>

      {showOverride ? (
        <ManagerOverrideDialog
          title="Approve a repayment on a held account"
          description={`${formatGhs(amountMinor)} against ${account?.name ?? 'this customer'}. Taking money can quietly bypass a hold, so a manager decides.`}
          permission="credit.override"
          amountMinor={amountMinor}
          policy={lockoutPolicyFor(runtime.config)}
          onClose={() => setShowOverride(false)}
          onApproved={(proof) => void writeRepayment(proof)}
        />
      ) : null}
    </div>
  )
}
