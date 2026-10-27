import { createHash } from 'node:crypto'
import type { EvatCertificate } from '@sceptre/shared'
import type { EInvoicingProvider, EvatCertification, EvatDocument } from './evat.provider.ts'

/**
 * A deterministic provider for development, CI and the mock walkthrough.
 *
 * Two properties matter more than realism:
 *
 * 1. **Determinism.** Every certificate field is derived from the document
 *    number alone — never from the wall clock, a counter or a random source.
 *    Submitting the same document twice yields byte-identical fields, and a
 *    lookup for a number we never sent yields the same certificate GRA would
 *    have returned for it, so an `E700` adoption is provable in a test. (The
 *    plan's illustration put the branch code in the serial; a lookup only
 *    receives the number, so anything else in the certificate could not be
 *    reproduced on the adoption path.)
 * 2. **It cannot be mistaken for GRA.** The QR payload is on the reserved
 *    `.invalid` TLD (RFC 2606: guaranteed never to resolve), so a screenshot of a
 *    mock certificate is visibly not a fiscal one.
 *
 * The refusal switches are one-shot: each `certify` consumes one queued
 * failure, which is how a test walks the retry ladder (`failNextMockSubmission`
 * twice, then a success).
 */

interface QueuedFailure {
  code: string
  message: string
  retryable: boolean
}

const failures: QueuedFailure[] = []
let healthFails = false

interface MockEvatCallCounts {
  certify: number
  fetch: number
  health: number
}

let calls: MockEvatCallCounts = { certify: 0, fetch: 0, health: 0 }

/** A message a person can act on, keyed by GRA's own codes (research fact 10). */
const FAILURE_MESSAGES: Record<string, string> = {
  E700: 'GRA has already signed this document',
  E701: 'GRA does not know the invoice this refund names',
  E727: 'This invoice has already been refunded in full',
  E900: 'GRA rejected the security key',
}

/** GRA's stamp is a fixed reference day plus the digest's own seconds. */
const STAMP_REFERENCE_MS = Date.UTC(2026, 0, 1)

function certificateFor(documentNumber: string): EvatCertificate {
  const hex = createHash('sha256').update(documentNumber).digest('hex')
  const digits = (Number.parseInt(hex.slice(0, 8), 16) % 100_000_000).toString().padStart(8, '0')
  const signature = [0, 1, 2, 3].map((group) => hex.slice(group * 4, group * 4 + 4)).join('-')
  const stampSeconds = Number.parseInt(hex.slice(48, 56), 16) % 86_400

  return {
    providerInvoiceNumber: documentNumber,
    sdcId: `SDC-MOCK-${hex.slice(16, 24).toUpperCase()}`,
    serial: `MOCK-${digits}`,
    signature,
    internalData: `MOCK-${hex.slice(24, 40).toUpperCase()}`,
    machineCode: `MRC-MOCK-${hex.slice(40, 48).toUpperCase()}`,
    stampedAt: new Date(STAMP_REFERENCE_MS + stampSeconds * 1000).toISOString(),
    // `.invalid` is reserved by RFC 2606 and can never resolve, so this QR can
    // never be mistaken for GRA's verification page.
    qrPayload: `https://evat.mock.invalid/verify?data=${encodeURIComponent(documentNumber)}`,
  }
}

export class MockEvatProvider implements EInvoicingProvider {
  readonly name = 'MOCK' as const

  async healthCheck(): Promise<{ ok: boolean; detail?: string }> {
    calls.health += 1
    return healthFails
      ? { ok: false, detail: 'Mock E-VAT health check fails by request' }
      : { ok: true, detail: 'Mock E-VAT provider' }
  }

  async certify(document: EvatDocument): Promise<EvatCertification> {
    calls.certify += 1
    const failure = failures.shift()
    if (failure) return { ok: false, ...failure }
    return { ok: true, certificate: certificateFor(document.documentNumber) }
  }

  /**
   * The mock "lookup" returns the certificate the number implies, because a
   * mock cannot already hold a document: `E700` recovery is precisely the case
   * where GRA has it and we do not.
   */
  async fetchCertificate(providerInvoiceNumber: string): Promise<EvatCertification | null> {
    calls.fetch += 1
    return { ok: true, certificate: certificateFor(providerInvoiceNumber) }
  }
}

/**
 * Makes the next certification refuse. Call it twice to fail twice; the queue
 * is FIFO so the retry ladder is walked in order.
 */
export function failNextMockSubmission(code: string, retryable = false, message?: string): void {
  failures.push({
    code,
    message: message ?? FAILURE_MESSAGES[code] ?? `Mock refusal ${code}`,
    retryable,
  })
}

/** Makes health checks report a failure until `resetMockEvat()`. */
export function makeMockHealthFail(): void {
  healthFails = true
}

export function getMockEvatCallCounts(): MockEvatCallCounts {
  return { ...calls }
}

/** A test resets this between cases; module state is deliberately process-local. */
export function resetMockEvat(): void {
  failures.length = 0
  healthFails = false
  calls = { certify: 0, fetch: 0, health: 0 }
}
