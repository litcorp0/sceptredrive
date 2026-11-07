import { isElectronicTender } from '@sceptre/shared'
import { LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { StatusNote } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PaymentClientError, type PaymentMethod, paymentsClient } from '@/lib/api/payments-client'
import type { CartTenderRecord } from '@/lib/cart/cart-repository'
import { useCart } from '@/lib/cart/cart-store'
import { getDesktopBridge } from '@/lib/desktop-api'
import { formatGhs } from '@/lib/format'
import { uuidv7 } from '@/lib/id'
import { useSyncStatus } from '@/lib/powersync/status'
import { useUploadStatus } from '@/lib/sync/sync-status-store'
import {
  type ElectronicTender,
  MOMO_PROVIDER_LABELS,
  MOMO_PROVIDERS,
  type MomoProvider,
  normalizeMomoPhone,
  PAYMENT_FAILED_FALLBACK,
  PAYMENT_POLL_INTERVAL_MS,
  remainingMs,
  transition,
} from '../utils/electronic'

/**
 * The electronic tender panel (Plan 09 Task 3).
 *
 * MoMo, bank transfer and card all start with the same server call, and all of
 * them are money only when the server says `PAID` (P13-D6). The panel shows the
 * server's `displayText` verbatim, polls every three seconds, and stops at
 * `expires_at` by asking the server to abandon — once.
 *
 * The card form is never ours. The main process opens Paystack Checkout in a
 * window with no preload; this component only receives an `authorization_url`
 * and asks the bridge to show it. There is no card input in this file.
 *
 * The in-flight tender goes through the cart's 150 ms debounce, so a crash
 * during a 180-second authorisation costs a click, not a customer's payment
 * (P13-D31).
 */

export interface PaidElectronicTender {
  /** Stable line id: the payment id, so a resume cannot add the same money twice. */
  id: string
  method: 'MOMO' | 'CARD' | 'BANK_TRANSFER'
  amountMinor: number
  paymentId: string
  providerReference: string
}

type PanelMethod = PaymentMethod

const METHOD_LABELS: Record<PanelMethod, string> = {
  MOMO: 'MoMo',
  BANK_TRANSFER: 'Bank transfer',
  CARD: 'Card',
}

export function ElectronicTenderPanel({
  draftId,
  shiftId,
  method,
  remainingMinor,
  onPaid,
  onSwitchToCash,
}: {
  draftId: string
  shiftId: string
  /** Chosen by the tender screen's method switch; one method at a time. */
  method: PanelMethod
  remainingMinor: number
  onPaid: (tender: PaidElectronicTender) => void
  onSwitchToCash: () => void
}) {
  const { cartTenders, setCartTenders } = useCart()
  const upload = useUploadStatus()
  const sync = useSyncStatus()
  const navOnline = useNavigatorOnline()
  // The sync badge is the app's own signal; `navigator.onLine` only says the
  // cable is in. Both must agree before we offer a provider round trip.
  const online = navOnline && (sync.online || sync.hasSynced || upload.online)

  const [momoProvider, setMomoProvider] = useState<MomoProvider>('mtn')
  const [phone, setPhone] = useState('')
  const [phoneProblem, setPhoneProblem] = useState<string | null>(null)
  const [active, setActive] = useState<ElectronicTender | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [otp, setOtp] = useState('')
  const [otpBusy, setOtpBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const activeRef = useRef<ElectronicTender | null>(null)
  const abandoned = useRef<Set<string>>(new Set())
  const openedCheckout = useRef<Set<string>>(new Set())
  const paid = useRef<Set<string>>(new Set())
  const resumed = useRef(false)

  activeRef.current = active

  // The code belongs to one charge, not to the next one: clear it whenever the
  // panel moves to a different payment id.
  useEffect(() => {
    setOtp('')
    setOtpBusy(false)
  }, [active?.paymentId])

  function persist(tender: ElectronicTender | null, paymentId?: string | null): void {
    const id = tender?.paymentId ?? paymentId ?? null
    const without = cartTenders.filter(
      (row) => row.draftId !== draftId || (id ? row.paymentId !== id : true),
    )

    if (!tender) {
      setCartTenders(without)
      return
    }

    const existing = cartTenders.find(
      (row) => row.draftId === draftId && row.paymentId === tender.paymentId,
    )
    const next: CartTenderRecord = {
      id: existing?.id ?? crypto.randomUUID(),
      draftId,
      sequence: existing?.sequence ?? rowsForDraft.length + 1,
      method: tender.method,
      amountMinor: tender.amountMinor,
      momoProvider: tender.momoProvider ?? null,
      phone: tender.phone ?? null,
      paymentId: tender.paymentId,
      providerReference: tender.providerReference,
      status: tender.status,
      displayText: tender.displayText,
      expiresAt: tender.expiresAt,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    }
    setCartTenders([...without, next].sort((left, right) => left.sequence - right.sequence))
  }

  const rowsForDraft = cartTenders.filter((row) => row.draftId === draftId)

  function addPaid(tender: ElectronicTender): void {
    const paymentId = tender.paymentId
    if (!paymentId || paid.current.has(paymentId)) return
    paid.current.add(paymentId)
    onPaid({
      id: paymentId,
      method: tender.method,
      amountMinor: tender.amountMinor,
      paymentId,
      providerReference: tender.providerReference ?? '',
    })
  }

  function apply(outcome: ReturnType<typeof transition>): void {
    if (outcome.message) setMessage(outcome.message)

    if (outcome.addTender && outcome.tender) {
      persist(outcome.tender)
      addPaid(outcome.tender)
      // The panel folds away once the money is on the sale; the line is visible
      // in the tender list and `remainingMinor` has already moved.
      setActive(null)
      setMessage(
        `${METHOD_LABELS[outcome.tender.method]} ${formatGhs(outcome.tender.amountMinor)} received.`,
      )
      return
    }

    setActive(outcome.tender)
    if (outcome.tender) persist(outcome.tender)
    else persist(null, activeRef.current?.paymentId ?? null)

    if (outcome.abandon && outcome.tender?.paymentId) {
      void abandonOnce(outcome.tender.paymentId)
    }
    if (outcome.tender && outcome.tender.status !== 'PENDING') closeCheckout()
  }

  async function abandonOnce(paymentId: string): Promise<void> {
    if (abandoned.current.has(paymentId)) return
    abandoned.current.add(paymentId)
    try {
      const payment = await paymentsClient.abandon(paymentId)
      apply(transition(activeRef.current, { type: 'abandoned', payment }))
    } catch (error) {
      // The server stopped waiting at 180 s either way; a failed call must not
      // become a failed payment on screen.
      setMessage(
        retryable(error)
          ? 'Could not reach the server to close this payment. It will expire on its own.'
          : describe(error),
      )
    }
  }

  async function openCheckout(url: string): Promise<void> {
    try {
      const checkout = getDesktopBridge().payments?.checkout
      if (!checkout) {
        setMessage('The secure card window is unavailable on this terminal.')
        return
      }
      const response = await checkout.open(url)
      if (!response.ok) {
        setMessage('The secure card window is unavailable on this terminal.')
        return
      }
      if (!response.data.ok) {
        setMessage(
          response.data.reason === 'UNTRUSTED_URL'
            ? 'The server sent an address this terminal does not trust. Use cash or ask a manager.'
            : 'The secure card window could not be opened. Try again or take cash.',
        )
      }
    } catch {
      setMessage('The secure card window is unavailable on this terminal.')
    }
  }

  async function reopenCheckout(): Promise<void> {
    const paymentId = activeRef.current?.paymentId
    if (!paymentId) return
    try {
      const payment = await paymentsClient.get(paymentId)
      if (payment.authorizationUrl) await openCheckout(payment.authorizationUrl)
      else setMessage('The server has no card link for this payment yet.')
    } catch (error) {
      setMessage(describe(error))
    }
  }

  // Resume the draft's in-flight tender once per mount (P13-D31).
  useEffect(() => {
    if (resumed.current) return
    resumed.current = true

    for (const row of rowsForDraft) {
      if (!row.paymentId) continue
      if (!isElectronicTender(row.method)) continue
      const paymentId = row.paymentId
      const outcome = transition(null, {
        type: 'resume',
        row: {
          paymentId,
          method: row.method,
          amountMinor: row.amountMinor,
          status: row.status,
          displayText: row.displayText,
          expiresAt: row.expiresAt,
          providerReference: row.providerReference,
        },
        now: Date.now(),
      })

      if (outcome.addTender && outcome.tender) {
        addPaid(outcome.tender)
        setMessage(
          `${METHOD_LABELS[outcome.tender.method]} ${formatGhs(outcome.tender.amountMinor)} was already paid.`,
        )
      } else if (outcome.tender) {
        activeRef.current = outcome.tender
        setActive(outcome.tender)
        if (outcome.abandon) void abandonOnce(paymentId)
      } else {
        if (outcome.message) setMessage(outcome.message)
        persist(null, paymentId)
      }
    }
    // This is the restart path, read once — not a watcher over the rows.
  }, [])

  // Poll while PENDING and fire one last check at expiry.
  useEffect(() => {
    if (!active || active.status !== 'PENDING' || !active.paymentId) return
    const paymentId = active.paymentId
    let cancelled = false

    const tick = async (): Promise<void> => {
      try {
        const payment = await paymentsClient.get(paymentId, { refresh: true })
        if (cancelled) return
        apply(transition(activeRef.current, { type: 'update', payment, now: Date.now() }))
      } catch (error) {
        if (cancelled) return
        if (retryable(error)) {
          // Still pending, still ours: keep the spinner and the countdown.
          setMessage('Still waiting for the payment network…')
          return
        }
        setMessage(describe(error))
      }
    }

    void tick()
    const interval = setInterval(() => void tick(), PAYMENT_POLL_INTERVAL_MS)
    const expiry = remainingMs(active.expiresAt, Date.now())
    const expiryTimer = setTimeout(() => void tick(), expiry + 25)
    const countdown = setInterval(() => setNow(Date.now()), 1_000)

    return () => {
      cancelled = true
      clearInterval(interval)
      clearTimeout(expiryTimer)
      clearInterval(countdown)
    }
    // `apply` reads the latest tender through the ref.
  }, [active?.paymentId, active?.status])

  // Card: the checkout opens once, automatically, and never from our renderer.
  useEffect(() => {
    if (!active || active.method !== 'CARD' || active.status !== 'PENDING') return
    if (!active.paymentId || openedCheckout.current.has(active.paymentId)) return
    const paymentId = active.paymentId
    openedCheckout.current.add(paymentId)
    if (active.authorizationUrl) {
      void openCheckout(active.authorizationUrl)
      return
    }
    void paymentsClient
      .get(paymentId)
      .then((payment) => {
        if (payment.authorizationUrl) void openCheckout(payment.authorizationUrl)
      })
      .catch(() => {})
  }, [active?.paymentId, active?.method, active?.status])

  async function start(): Promise<void> {
    if (busy || !online || !shiftId || remainingMinor <= 0) return

    let customerPhone: string | undefined
    if (method === 'MOMO') {
      const normalised = normalizeMomoPhone(phone)
      if (!normalised) {
        setPhoneProblem('Enter a Ghana mobile number, for example 024 123 4567.')
        return
      }
      customerPhone = normalised
    }

    setPhoneProblem(null)
    setMessage(null)
    setBusy(true)

    try {
      const payment = await paymentsClient.create({
        clientPaymentId: uuidv7(),
        method,
        amountMinor: remainingMinor,
        shiftId,
        ...(method === 'MOMO' && customerPhone
          ? { mobileMoney: { provider: momoProvider, phone: customerPhone } }
          : {}),
      })

      const outcome = transition(null, { type: 'update', payment, now: Date.now() })
      if (!outcome.tender) {
        setMessage(outcome.message)
        return
      }

      const tender: ElectronicTender = {
        ...outcome.tender,
        momoProvider: method === 'MOMO' ? momoProvider : null,
        phone: customerPhone ?? null,
      }
      setActive(tender)
      persist(tender)
      if (outcome.message) setMessage(outcome.message)
      if (tender.status === 'PAID') {
        addPaid(tender)
        setActive(null)
        setMessage(`${METHOD_LABELS[tender.method]} ${formatGhs(tender.amountMinor)} received.`)
      }
      // The card window opens from the effect above, once the tender is shown.
    } catch (error) {
      // A retryable failure is "we do not know yet", not "the customer refused".
      setMessage(
        retryable(error)
          ? 'Could not reach the payment network. Nothing has been taken; try again when the signal returns.'
          : describe(error),
      )
    } finally {
      setBusy(false)
    }
  }

  async function submitCode(): Promise<void> {
    const paymentId = activeRef.current?.paymentId
    if (!paymentId || otpBusy) return

    const code = otp.trim()
    if (!/^\d{4,8}$/.test(code)) {
      setMessage('Enter the one-time code sent to the customer’s phone.')
      return
    }

    setOtpBusy(true)
    setMessage(null)

    try {
      const payment = await paymentsClient.submitOtp(paymentId, code)
      setOtp('')
      apply(transition(activeRef.current, { type: 'update', payment, now: Date.now() }))
      if (payment.status === 'PENDING') {
        setMessage(
          payment.failedCode === 'otp_invalid'
            ? (payment.failedMessage ?? 'That code was not accepted. Check it and try again.')
            : 'Still waiting for the payment network…',
        )
      }
    } catch (error) {
      setMessage(
        retryable(error)
          ? 'Could not reach the payment network. Check the code again when the signal returns.'
          : describe(error),
      )
    } finally {
      setOtpBusy(false)
    }
  }

  async function cancel(): Promise<void> {
    const paymentId = activeRef.current?.paymentId
    closeCheckout()
    if (paymentId) await abandonOnce(paymentId)
    persist(null, paymentId)
    setActive(null)
    setMessage(null)
  }

  function reset(): void {
    persist(null, activeRef.current?.paymentId)
    setActive(null)
    setMessage(null)
  }

  const waiting = active?.status === 'PENDING'
  const canOfferMethods = !active && !busy
  const countdownSeconds = active ? Math.ceil(remainingMs(active.expiresAt, now) / 1_000) : 0

  return (
    <div className="grid gap-3" data-testid="electronic-tender">
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Take an electronic payment</h2>
          <span className="font-mono text-sm tabular-nums" data-testid="electronic-amount">
            {formatGhs(remainingMinor)}
          </span>
        </div>

        {!online ? (
          <StatusNote tone="notice" role="status" data-testid="electronic-offline">
            MoMo and card need a connection. Cash and credit do not.
          </StatusNote>
        ) : null}

        {canOfferMethods ? (
          <>
            {method === 'MOMO' ? (
              <div className="grid gap-2">
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={momoProvider}
                  onValueChange={(value) => {
                    if (MOMO_PROVIDERS.includes(value as MomoProvider)) {
                      setMomoProvider(value as MomoProvider)
                    }
                  }}
                  aria-label="Mobile money network"
                  className="flex w-full"
                >
                  {MOMO_PROVIDERS.map((provider) => (
                    <ToggleGroupItem
                      key={provider}
                      value={provider}
                      disabled={!online}
                      className="h-11 flex-1 text-sm"
                      data-testid={`momo-provider-${provider}`}
                    >
                      {MOMO_PROVIDER_LABELS[provider]}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>

                <Label htmlFor="momo-phone" className="text-xs text-muted-foreground">
                  Customer&apos;s mobile number
                </Label>
                <Input
                  id="momo-phone"
                  value={phone}
                  inputMode="tel"
                  autoComplete="off"
                  placeholder="024 123 4567"
                  disabled={!online}
                  onChange={(event) => {
                    setPhone(event.target.value)
                    setPhoneProblem(null)
                  }}
                  aria-invalid={phoneProblem ? true : undefined}
                  aria-describedby={phoneProblem ? 'momo-phone-problem' : undefined}
                  data-testid="electronic-phone"
                />
                {phoneProblem ? (
                  <p id="momo-phone-problem" className="text-xs text-danger" role="alert">
                    {phoneProblem}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    The customer approves the prompt on this phone.
                  </p>
                )}
              </div>
            ) : method === 'BANK_TRANSFER' ? (
              <p className="text-xs text-muted-foreground">
                The till shows the account the customer transfers to, then waits for the bank.
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Paystack opens a secure window for the card. This till never sees the card number.
              </p>
            )}

            <Button
              type="button"
              onClick={() => void start()}
              disabled={!online || !shiftId || busy || remainingMinor <= 0}
              className="mt-3 h-11 w-full"
              data-testid="electronic-start"
            >
              {busy ? 'Starting…' : `Start ${formatGhs(remainingMinor)} payment`}
            </Button>
          </>
        ) : null}

        {active ? (
          <div
            className="mt-3 grid gap-2 rounded-md border border-border bg-muted/30 p-3"
            data-testid="electronic-pending"
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              {waiting ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
              <span>
                {METHOD_LABELS[active.method]} {formatGhs(active.amountMinor)}
              </span>
              {waiting ? (
                <span className="ml-auto font-mono text-xs tabular-nums text-muted-foreground">
                  {countdownSeconds}s
                </span>
              ) : null}
            </div>

            {active.method === 'BANK_TRANSFER' ? <BankAccountBlock tender={active} /> : null}

            <p className="text-sm" data-testid="electronic-display-text">
              {active.displayText ??
                (waiting
                  ? 'Waiting for the payment network to confirm…'
                  : active.status === 'PAID'
                    ? 'Paid.'
                    : '')}
            </p>

            {active.method === 'MOMO' && waiting && active.requiresOtp ? (
              <form
                className="grid gap-2 rounded-md border border-border bg-background p-3"
                onSubmit={(event) => {
                  event.preventDefault()
                  void submitCode()
                }}
              >
                <Label htmlFor="payment-otp" className="text-xs text-muted-foreground">
                  One-time code from the customer’s phone
                </Label>
                <Input
                  id="payment-otp"
                  value={otp}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  disabled={otpBusy}
                  placeholder="123456"
                  onChange={(event) => setOtp(event.target.value)}
                  aria-invalid={active.failedCode === 'otp_invalid' ? true : undefined}
                  aria-describedby={
                    active.failedCode === 'otp_invalid' && active.failedMessage
                      ? 'payment-otp-problem'
                      : undefined
                  }
                  data-testid="electronic-otp"
                />
                {active.failedCode === 'otp_invalid' && active.failedMessage ? (
                  <p id="payment-otp-problem" className="text-xs text-danger" role="alert">
                    {active.failedMessage}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    The customer reads the code sent to their phone. It is never stored.
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={otpBusy || otp.trim().length < 4}
                  className="h-11"
                  data-testid="electronic-otp-submit"
                >
                  {otpBusy ? 'Checking…' : 'Submit code'}
                </Button>
              </form>
            ) : null}

            {active.method === 'CARD' && waiting ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void reopenCheckout()}
                className="h-11"
                data-testid="electronic-open-card"
              >
                Open secure card window
              </Button>
            ) : null}

            {active.status === 'PAID' ? (
              <StatusNote tone="ok" role="status">
                The money is in. It is on the sale as a tender.
              </StatusNote>
            ) : null}

            {active.status === 'FAILED' ||
            active.status === 'EXPIRED' ||
            active.status === 'ABANDONED' ? (
              <div className="grid gap-2">
                <StatusNote tone="danger" role="alert">
                  {active.failedMessage ?? active.displayText ?? PAYMENT_FAILED_FALLBACK}
                </StatusNote>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={reset} className="h-11 flex-1">
                    Retry
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onSwitchToCash}
                    className="h-11 flex-1"
                  >
                    Switch to cash
                  </Button>
                </div>
              </div>
            ) : null}

            {waiting ? (
              <Button type="button" variant="ghost" onClick={() => void cancel()} className="h-11">
                Cancel this payment
              </Button>
            ) : null}
          </div>
        ) : null}

        {message ? (
          <StatusNote tone="notice" role="status" className="mt-2" data-testid="electronic-message">
            {message}
          </StatusNote>
        ) : null}
      </div>
    </div>
  )
}

function BankAccountBlock({ tender }: { tender: ElectronicTender }) {
  return (
    <dl
      className="grid gap-1 rounded-md border border-border bg-background px-3 py-2"
      data-testid="bank-account"
    >
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-xs text-muted-foreground">Account number</dt>
        <dd className="font-mono text-base font-semibold tabular-nums">
          {tender.accountNumber ?? '—'}
        </dd>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-xs text-muted-foreground">Account name</dt>
        <dd className="text-sm">{tender.accountName ?? '—'}</dd>
      </div>
      <div className="flex items-baseline justify-between gap-3">
        <dt className="text-xs text-muted-foreground">Bank</dt>
        <dd className="text-sm">{tender.accountBank ?? '—'}</dd>
      </div>
    </dl>
  )
}

function closeCheckout(): void {
  try {
    void getDesktopBridge().payments?.checkout.close()
  } catch {
    // No bridge (web preview or a test): there is no window to close.
  }
}

function useNavigatorOnline(): boolean {
  const [online, setOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine !== false,
  )
  useEffect(() => {
    const up = (): void => setOnline(true)
    const down = (): void => setOnline(false)
    window.addEventListener('online', up)
    window.addEventListener('offline', down)
    return () => {
      window.removeEventListener('online', up)
      window.removeEventListener('offline', down)
    }
  }, [])
  return online
}

function retryable(error: unknown): boolean {
  return error instanceof PaymentClientError && error.retryable
}

function describe(error: unknown): string {
  if (error instanceof PaymentClientError) {
    return error.serverCode === 'PAYMENT_PROVIDER_DISABLED'
      ? 'Card payments are not enabled on this server.'
      : error.message
  }
  return error instanceof Error ? error.message : 'The payment could not be started.'
}
