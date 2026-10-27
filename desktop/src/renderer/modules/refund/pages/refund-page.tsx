import {
  formatTime,
  REFUND_REASON_LABELS,
  REFUND_REASONS,
  REFUND_RESTOCK_LABELS,
  REFUND_RESTOCK_OPTIONS,
  type RefundReason,
  type RefundRestock,
} from '@sceptre/shared'
import { useMemo, useState } from 'react'
import { ManagerOverrideDialog, ScreenHeader, StatusNote } from '@/components/common'
import { AppHeader } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { StaffSession } from '@/lib/auth/staff-session'
import type { CartOverrideProof } from '@/lib/cart/types'
import { formatGhs, formatMinorPlain, parseGhsToMinor } from '@/lib/format'
import { lockoutPolicyFor } from '@/lib/pos-config'
import type { OpenShiftSummary, PosIdentityRow } from '@/lib/pos-runtime'
import { usePosRuntime } from '@/lib/pos-runtime'
import { usePos } from '@/lib/powersync/provider'
import { printRefund } from '@/lib/printing/print-sale'
import { desktopPrinterTransport } from '@/lib/printing/printer-service'
import { loadPrinterSettings } from '@/lib/printing/settings'
import {
  buildRefundReceiptModel,
  type ReceiptContext,
  type RefundReceiptModel,
  refundReceiptToText,
} from '@/lib/receipt/render'
import { priceRefundLines, refundableLineQuantity } from '@/lib/refund/refund-pricing'
import { loadRefundDraft, searchRefundableSales } from '@/lib/refund/refund-repository'
import { refundNoteProblem } from '@/lib/refund/refund-rules'
import { createRefund, type RefundResult } from '@/lib/refund/refund-service'
import type { RefundSource, SaleSearchRow } from '@/lib/refund/refund-types'
import { navigate } from '@/lib/router'
import { readCashierName, readReceiptContext } from '@/lib/sale/sale-repository'

/**
 * Refunds at the till (Plan 10 Task 3; P13-D17…P13-D26).
 *
 * The flow is find → lines → tenders → reason → authorise → write → print.
 * Everything except the printer is local, so a cash refund completes with the
 * cable out. The screen shows the refunded total the lines produce and refuses
 * to submit unless the tender allocation equals it — the server's
 * `REFUND_LINE_TOTAL_MISMATCH` is a refusal the till should never provoke.
 *
 * Electronic tenders are displayed as **pending**: the server dispatches the
 * provider refund after the upload, and the till never calls Paystack for a
 * refund (P13-D26).
 */

interface LineChoice {
  quantity: number
  restock: RefundRestock
  damageReason: string
}

function moneyInput(value: string): number | null {
  if (!value.trim()) return 0
  return parseGhsToMinor(value)
}

export function RefundScreen({
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
  const [results, setResults] = useState<SaleSearchRow[] | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [source, setSource] = useState<RefundSource | null>(null)
  const [choices, setChoices] = useState<Record<string, LineChoice>>({})
  const [tenderText, setTenderText] = useState<Record<string, string>>({})
  const [reasonCode, setReasonCode] = useState<RefundReason>('CUSTOMER_CHANGED_MIND')
  const [note, setNote] = useState('')
  const [showOverride, setShowOverride] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<RefundResult | null>(null)
  const [receipt, setReceipt] = useState<RefundReceiptModel | null>(null)
  const [printMessage, setPrintMessage] = useState<string | null>(null)

  async function search(): Promise<void> {
    if (!db || !query.trim()) return
    setSearchError(null)
    try {
      setResults(await searchRefundableSales(db, { query }))
    } catch (cause) {
      setSearchError(cause instanceof Error ? cause.message : 'The search failed')
    }
  }

  async function choose(row: SaleSearchRow): Promise<void> {
    if (!db) return
    setError(null)
    try {
      const loaded = await loadRefundDraft(db, row.saleId)
      setSource(loaded)
      setChoices(
        Object.fromEntries(
          loaded.lines.map((line) => [
            line.saleLineId,
            { quantity: 0, restock: 'RESALABLE' as RefundRestock, damageReason: '' },
          ]),
        ),
      )
      setTenderText(Object.fromEntries(loaded.tenders.map((tender) => [tender.saleTenderId, ''])))
      setCreated(null)
      setReceipt(null)
      setPrintMessage(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That receipt could not be opened')
    }
  }

  const requestedLines = useMemo(
    () =>
      source
        ? source.lines
            .filter((line) => (choices[line.saleLineId]?.quantity ?? 0) > 0)
            .map((line) => {
              const choice = choices[line.saleLineId] as LineChoice
              return {
                saleLineId: line.saleLineId,
                quantity: choice.quantity,
                restock: choice.restock,
                damageReason: choice.damageReason,
              }
            })
        : [],
    [source, choices],
  )

  const pricing = useMemo(() => {
    if (!source || requestedLines.length === 0) return null
    try {
      return priceRefundLines(source, requestedLines)
    } catch {
      return null
    }
  }, [source, requestedLines])

  const pricingProblem = useMemo(() => {
    if (!source || requestedLines.length === 0) return null
    try {
      priceRefundLines(source, requestedLines)
      return null
    } catch (cause) {
      return cause instanceof Error ? cause.message : 'The refund is not valid'
    }
  }, [source, requestedLines])

  const tenderAmounts = source
    ? Object.fromEntries(
        source.tenders.map((tender) => [
          tender.saleTenderId,
          moneyInput(tenderText[tender.saleTenderId] ?? '') ?? 0,
        ]),
      )
    : {}
  const tenderedMinor = Object.values(tenderAmounts).reduce((sum, value) => sum + value, 0)
  const refundedMinor = pricing?.refundedMinor ?? 0
  const mismatch = refundedMinor > 0 && tenderedMinor !== refundedMinor
  const noteProblem = refundNoteProblem(reasonCode, note)
  const canSubmit =
    Boolean(source) &&
    Boolean(shift) &&
    Boolean(pricing) &&
    refundedMinor > 0 &&
    tenderedMinor === refundedMinor &&
    !noteProblem &&
    !busy

  function setLine(saleLineId: string, patch: Partial<LineChoice>): void {
    setChoices((current) => ({
      ...current,
      [saleLineId]: { ...(current[saleLineId] as LineChoice), ...patch },
    }))
    // A proof authorises one document: changing the money means ask again.
  }

  function fillRemaining(): void {
    if (!source || refundedMinor < 1) return
    let left = refundedMinor
    const next: Record<string, string> = {}
    for (const tender of source.tenders) {
      const take = Math.min(left, tender.refundableMinor)
      next[tender.saleTenderId] = take > 0 ? formatMinorPlain(take) : ''
      left -= take
    }
    setTenderText(next)
  }

  async function submit(proof: CartOverrideProof): Promise<void> {
    if (!db || !source || !pricing) return
    setBusy(true)
    setError(null)
    try {
      const result = await createRefund(db, {
        saleId: source.saleId,
        lines: requestedLines,
        // Only tenders with money on them are allocations; a blank row is not a
        // zero-amount tender, which the shared cap check would rightly refuse.
        tenders: Object.entries(tenderAmounts)
          .filter(([, amountMinor]) => amountMinor > 0)
          .map(([saleTenderId, amountMinor]) => ({ saleTenderId, amountMinor })),
        reasonCode,
        note,
        approval: proof,
      })
      setCreated(result)
      await printResult(db, result, false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The refund could not be written')
    } finally {
      setBusy(false)
    }
  }

  async function printResult(
    database: NonNullable<typeof db>,
    result: RefundResult,
    reprint: boolean,
  ): Promise<void> {
    if (!source) return
    try {
      const [context, cashierName, settings] = await Promise.all([
        readReceiptContext(database),
        readCashierName(database, staff.staffId),
        loadPrinterSettings(database),
      ])
      const model = buildRefundReceiptModel({
        context: (context ?? {
          branchName: identity.branchName,
          branchCode: identity.branchCode,
          terminalCode: identity.terminalCode,
        }) as ReceiptContext,
        refundNumber: result.number,
        originalReceiptNumber: source.receiptNumber,
        occurredAt: result.occurredAt,
        cashierName,
        managerStaffId: result.managerStaffId,
        reasonCode: result.reasonCode,
        note: result.note,
        lines: result.lines.map((line) => ({
          name: line.name,
          quantity: line.quantity,
          restock: line.restock,
          totalMinor: line.totalMinor,
        })),
        tenders: result.tenders.map((tender) => ({
          method: tender.method,
          amountMinor: tender.amountMinor,
          status: tender.status,
        })),
        totals: result.totals,
        reprint,
      })
      setReceipt(model)
      const outcome = await printRefund({ transport: desktopPrinterTransport, settings }, model)
      setPrintMessage(
        outcome.ok
          ? reprint
            ? 'Reprinted'
            : 'Printed'
          : outcome.code === 'PRINTER_NOT_CONFIGURED'
            ? 'No printer is configured. The refund is saved; reprint it from this screen.'
            : outcome.message,
      )
    } catch (cause) {
      setPrintMessage(
        cause instanceof Error
          ? cause.message
          : 'The refund is saved; the receipt could not be printed.',
      )
    }
  }

  if (created && receipt) {
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
            data-testid="refund-receipt"
          >
            {refundReceiptToText(receipt, { columns: 42 })}
          </pre>
          <aside className="grid content-start gap-3">
            <StatusNote tone="ok" role="status">
              Refund {created.number} recorded. {formatGhs(created.refundedMinor)} goes back.
            </StatusNote>
            {printMessage ? (
              <StatusNote tone="info" role="status" data-testid="refund-print-message">
                {printMessage}
              </StatusNote>
            ) : null}
            <Button
              type="button"
              variant="outline"
              className="h-11"
              disabled={busy}
              onClick={() => {
                if (db) void printResult(db, created, true)
              }}
            >
              Print again
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => {
                setCreated(null)
                setReceipt(null)
                setSource(null)
                setResults(null)
                setQuery('')
                setPrintMessage(null)
              }}
            >
              Refund another receipt
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
      <main className="mx-auto max-w-5xl p-6">
        <ScreenHeader
          title="Refund a receipt"
          description="Find a receipt this terminal recorded, choose what is coming back, and allocate it across the tenders that were taken."
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
            Open a shift before refunding money: a refund leaves this drawer.
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
              <Label htmlFor="refund-search">Receipt number or customer phone</Label>
              <Input
                id="refund-search"
                data-testid="refund-search"
                value={query}
                autoFocus
                onChange={(event) => setQuery(event.target.value)}
                placeholder="ACC-SPX-T01-20261027-0007 or 024 123 4567"
                className="h-12 font-mono"
              />
            </div>
            <Button type="submit" className="h-12 px-5">
              Find receipt
            </Button>
          </form>

          {searchError ? (
            <StatusNote tone="danger" role="alert" className="mx-4">
              {searchError}
            </StatusNote>
          ) : null}

          {results ? (
            results.length === 0 ? (
              <p className="px-4 text-sm text-muted-foreground" data-testid="refund-no-results">
                No receipt on this terminal matches that. A receipt from another till must be
                refunded from the office console.
              </p>
            ) : (
              <ul className="grid gap-1 px-4" data-testid="refund-results">
                {results.map((row) => {
                  const done = row.refundableMinor === 0
                  return (
                    <li key={row.saleId}>
                      <button
                        type="button"
                        onClick={() => void choose(row)}
                        disabled={done}
                        className="flex w-full flex-wrap items-baseline justify-between gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                        data-testid={`refund-result-${row.receiptNumber}`}
                      >
                        <span className="font-mono">{row.receiptNumber}</span>
                        <span className="text-muted-foreground">{formatTime(row.occurredAt)}</span>
                        <span className="font-mono tabular-nums">{formatGhs(row.totalMinor)}</span>
                        <span className="text-xs text-muted-foreground">
                          {done
                            ? 'Already fully refunded'
                            : `${formatGhs(row.refundableMinor)} refundable`}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )
          ) : null}
        </Card>

        {source ? (
          <div className="mt-4 grid gap-4">
            <Card className="gap-2 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-4">
                <div>
                  <p className="text-xs text-muted-foreground uppercase">Original receipt</p>
                  <p className="font-mono text-sm">{source.receiptNumber}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">Paid</p>
                  <p className="font-mono text-sm tabular-nums">
                    {formatGhs(source.tenderTotalMinor - source.changeMinor)}
                  </p>
                </div>
              </div>
            </Card>

            <section aria-label="Lines coming back" className="rounded-lg border border-border">
              <h2 className="border-b border-border bg-muted/40 px-4 py-2 text-xs font-medium tracking-wide uppercase">
                Lines
              </h2>
              <ul className="divide-y divide-border">
                {source.lines.map((line) => {
                  const choice = choices[line.saleLineId]
                  if (!choice) return null
                  const cap = refundableLineQuantity(line)
                  return (
                    <li key={line.saleLineId} className="grid gap-2 px-4 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-medium">{line.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {cap} of {line.quantity} refundable
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-3">
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            className="h-11 w-11 text-base"
                            aria-label={`Fewer units of ${line.name}`}
                            disabled={choice.quantity <= 0}
                            onClick={() =>
                              setLine(line.saleLineId, {
                                quantity: Math.max(0, choice.quantity - 1),
                              })
                            }
                          >
                            −
                          </Button>
                          <span
                            className="w-10 text-center font-mono text-base tabular-nums"
                            data-testid={`refund-qty-${line.saleLineId}`}
                          >
                            {choice.quantity}
                          </span>
                          <Button
                            type="button"
                            variant="outline"
                            className="h-11 w-11 text-base"
                            aria-label={`More units of ${line.name}`}
                            disabled={choice.quantity >= cap}
                            onClick={() =>
                              setLine(line.saleLineId, {
                                quantity: Math.min(cap, choice.quantity + 1),
                              })
                            }
                          >
                            +
                          </Button>
                        </div>
                        <ToggleGroup
                          type="single"
                          variant="outline"
                          value={choice.restock}
                          onValueChange={(value) => {
                            if (!value) return
                            setLine(line.saleLineId, {
                              restock: value as RefundRestock,
                              damageReason: value === 'DAMAGED' ? choice.damageReason : '',
                            })
                          }}
                          aria-label={`What happens to ${line.name}`}
                          className="flex flex-wrap"
                        >
                          {REFUND_RESTOCK_OPTIONS.map((option) => (
                            <ToggleGroupItem
                              key={option}
                              value={option}
                              className="h-11 px-2.5 text-xs data-[state=on]:border-2 data-[state=on]:border-foreground"
                            >
                              {REFUND_RESTOCK_LABELS[option]}
                            </ToggleGroupItem>
                          ))}
                        </ToggleGroup>
                      </div>
                      {choice.restock === 'DAMAGED' ? (
                        <div className="grid gap-1.5">
                          <Label htmlFor={`damage-${line.saleLineId}`}>
                            What happened to the goods
                          </Label>
                          <Input
                            id={`damage-${line.saleLineId}`}
                            value={choice.damageReason}
                            onChange={(event) =>
                              setLine(line.saleLineId, { damageReason: event.target.value })
                            }
                            maxLength={200}
                            className="h-11"
                          />
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </section>

            <section aria-label="Refund allocation" className="rounded-lg border border-border">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2">
                <h2 className="text-xs font-medium tracking-wide uppercase">Money back</h2>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-9"
                  onClick={fillRemaining}
                  disabled={refundedMinor < 1}
                  data-testid="refund-fill-remaining"
                >
                  Fill remaining
                </Button>
              </div>
              <ul className="divide-y divide-border">
                {source.tenders.map((tender) => (
                  <li
                    key={tender.saleTenderId}
                    className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {tender.method === 'CREDIT'
                          ? 'Credit — reduces the account, no cash'
                          : tender.method === 'CASH'
                            ? 'Cash from the drawer'
                            : `${tender.method === 'MOMO' ? 'MoMo' : tender.method === 'CARD' ? 'Card' : 'Bank transfer'} — goes back through the provider when the network is back`}
                      </p>
                      <p className="text-[11px] text-muted-foreground tabular-nums">
                        Up to {formatGhs(tender.refundableMinor)}
                      </p>
                    </div>
                    <Input
                      aria-label={`Amount back on ${tender.method}`}
                      value={tenderText[tender.saleTenderId] ?? ''}
                      onChange={(event) => {
                        setTenderText((current) => ({
                          ...current,
                          [tender.saleTenderId]: event.target.value,
                        }))
                      }}
                      inputMode="decimal"
                      placeholder="0.00"
                      className="h-11 w-28 text-right font-mono"
                    />
                  </li>
                ))}
              </ul>
              <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3">
                <span className="text-sm text-muted-foreground">
                  Lines are worth{' '}
                  <span className="font-mono text-foreground tabular-nums">
                    {formatGhs(refundedMinor)}
                  </span>
                </span>
                <span
                  className="font-mono text-sm font-semibold tabular-nums"
                  data-testid="refund-tendered"
                >
                  {formatGhs(tenderedMinor)} allocated
                </span>
              </div>
              {mismatch ? (
                <StatusNote
                  tone="danger"
                  role="alert"
                  className="mx-4 mb-3"
                  data-testid="refund-mismatch"
                >
                  The tenders must add up to {formatGhs(refundedMinor)}. Use Fill remaining, or
                  adjust the lines.
                </StatusNote>
              ) : null}
              {pricingProblem ? (
                <StatusNote tone="notice" role="status" className="mx-4 mb-3">
                  {pricingProblem}
                </StatusNote>
              ) : null}
            </section>

            <section aria-label="Reason" className="rounded-lg border border-border px-4 py-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="refund-reason">Reason</Label>
                  <select
                    id="refund-reason"
                    value={reasonCode}
                    onChange={(event) => setReasonCode(event.target.value as RefundReason)}
                    className="h-11 rounded-md border border-border bg-background px-3 text-sm"
                  >
                    {REFUND_REASONS.map((reason) => (
                      <option key={reason} value={reason}>
                        {REFUND_REASON_LABELS[reason]}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="refund-note">
                    Note {reasonCode === 'OTHER' ? '(required)' : '(optional)'}
                  </Label>
                  <Input
                    id="refund-note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    maxLength={200}
                    className="h-11"
                    placeholder={reasonCode === 'OTHER' ? 'Say why in a few words' : 'Context'}
                  />
                </div>
              </div>
              {noteProblem ? (
                <p role="alert" className="mt-2 text-sm text-destructive">
                  {noteProblem}
                </p>
              ) : null}
            </section>

            <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
              <div>
                <p className="text-sm font-medium">
                  {formatGhs(refundedMinor)} back to the customer
                </p>
                <p className="text-[11px] text-muted-foreground">
                  A manager’s PIN authorises the refund. There is no way past it.
                </p>
              </div>
              <Button
                type="button"
                className="h-14 px-6 text-sm"
                disabled={!canSubmit}
                onClick={() => setShowOverride(true)}
                data-testid="authorise-refund"
              >
                {busy ? 'Writing…' : 'Authorise and refund'}
              </Button>
            </section>
          </div>
        ) : (
          <Empty className="mt-4 rounded-xl border border-border bg-card">
            <EmptyHeader>
              <EmptyTitle>No receipt chosen yet</EmptyTitle>
              <EmptyDescription>
                Search by receipt number or the customer’s phone. Only receipts this terminal
                recorded can be refunded here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </main>

      {showOverride ? (
        <ManagerOverrideDialog
          title="Authorise this refund"
          description={`${formatGhs(refundedMinor)} back across ${requestedLines.length} line${requestedLines.length === 1 ? '' : 's'}. A manager’s PIN is the authority.`}
          permission="pos.refund"
          amountMinor={refundedMinor}
          policy={lockoutPolicyFor(runtime.config)}
          onClose={() => setShowOverride(false)}
          onApproved={(proof) => void submit(proof)}
        />
      ) : null}
    </div>
  )
}
