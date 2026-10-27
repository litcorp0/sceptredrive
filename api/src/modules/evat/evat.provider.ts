import type { EvatCertificate, EvatDocumentKind } from '@sceptre/shared'
import { env } from '../../config/env.ts'
import { MockEvatProvider } from './evat.mock.provider.ts'

/**
 * The E-VAT provider seam (P14-D33).
 *
 * It is a seam, not an integration. GRA's integration document is behind an
 * onboarding portal, versioned (public copies exist at 6.0, 7.0 and 8.1, and
 * third-party integrations target 8.2), and the field names differ between
 * them. A client written against a document we cannot fetch or test would be
 * guesswork with a statutory deadline attached, so only the mock ships.
 *
 * The interface is deliberately small: a health check, a certification, and an
 * optional certificate lookup. The lookup is optional because only a provider
 * that can retrieve a document can recover from `E700` (already signed);
 * without it the row goes to `ATTENTION` and a person looks at it.
 */

/** What the seller's own records say about the location that sold. */
export interface EvatSeller {
  name: string
  tin: string
  vatNumber: string
  branchCode: string
  address: string | null
  city: string
  area: string | null
  phone: string | null
}

export interface EvatLine {
  name: string
  sku: string
  quantity: number
  unitPriceMinor: number
  lineTotalMinor: number
  taxCategory: string
}

/** A tender is the method and the money. No reference, no provider, no person. */
export interface EvatTender {
  method: string
  amountMinor: number
}

/**
 * The transaction GRA needs and nothing else: no customer name, no phone, no
 * tender reference. A fiscal document describes the sale, not the buyer.
 */
export interface EvatDocument {
  kind: EvatDocumentKind
  /** The sale's `receiptNumber` or the refund's `number`. */
  documentNumber: string
  /** The certified invoice a refund names; null for an invoice. */
  originalInvoiceNumber: string | null
  occurredAt: Date
  seller: EvatSeller
  currency: 'GHS'
  calculationType: 'INCLUSIVE' | 'EXCLUSIVE'
  totals: {
    baseMinor: number
    nhilMinor: number
    getfundMinor: number
    vatMinor: number
    totalMinor: number
  }
  lines: EvatLine[]
  tenders: EvatTender[]
}

/**
 * A refusal is a result, never an exception: the code is GRA's where GRA named
 * one, and `retryable` is the provider's judgement about whether the same
 * payload could succeed later.
 */
export interface EvatRefusal {
  ok: false
  code: string
  message: string
  retryable: boolean
}

export type EvatCertification = { ok: true; certificate: EvatCertificate } | EvatRefusal

export interface EInvoicingProvider {
  readonly name: 'MOCK' | 'GRA'
  healthCheck(): Promise<{ ok: boolean; detail?: string }>
  certify(document: EvatDocument): Promise<EvatCertification>
  /** Optional: only a provider that can look a document up can recover from `E700`. */
  fetchCertificate?(providerInvoiceNumber: string): Promise<EvatCertification | null>
}

/**
 * Our own codes for conditions GRA never sees. They exist so a refusal is
 * always a code and a message a person can act on rather than a silent row.
 */
export const EVAT_SERVICE_CODES = {
  /** A provider field came back empty: the certificate is not a certificate. */
  CERTIFICATE_INCOMPLETE: 'CERTIFICATE_INCOMPLETE',
  /** The seller's TIN or VAT number is blank; a blank TIN is not a submission. */
  SELLER_IDENTITY_MISSING: 'SELLER_IDENTITY_MISSING',
  /** The provider could not be constructed: `EVAT_PROVIDER=gra` has no client. */
  PROVIDER_NOT_READY: 'PROVIDER_NOT_READY',
  /** A provider call threw: a network failure or a timeout, not a refusal. */
  PROVIDER_UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
} as const

let cached: EInvoicingProvider | null = null
let overridden: EInvoicingProvider | null = null

/**
 * One provider per process, chosen by `EVAT_PROVIDER`, mirroring
 * `getPaymentProvider()`. The second check keeps a direct caller honest even
 * though `env.ts` already refused to boot without the credentials.
 */
export function getEvatProvider(): EInvoicingProvider {
  if (overridden) return overridden
  if (cached) return cached

  if (env.EVAT_PROVIDER === 'mock') {
    cached = new MockEvatProvider()
    return cached
  }

  if (!env.EVAT_BASE_URL || !env.EVAT_SECURITY_KEY) {
    throw new Error("EVAT_BASE_URL and EVAT_SECURITY_KEY are required when EVAT_PROVIDER is 'gra'")
  }

  // Deliberately no client: P14-D33. Pretending would stamp documents with a
  // mock signature while an operator believed GRA had them.
  throw new Error(
    'The GRA E-VAT client is not implemented (P14-D33); keep EVAT_PROVIDER=mock until GRA onboarding',
  )
}

/**
 * Test seam: a case that needs a provider without a certificate lookup (the
 * `E700` dead end) passes its own stub. `null` restores the configured one.
 */
export function setEvatProviderForTests(provider: EInvoicingProvider | null): void {
  overridden = provider
}
