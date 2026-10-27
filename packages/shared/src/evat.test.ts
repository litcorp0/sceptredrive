import { describe, expect, it } from 'vitest'
import {
  certificateProblem,
  EVAT_DEADLINE_HOURS,
  EVAT_DOCUMENT_KINDS,
  EVAT_ERROR_CODES,
  EVAT_MAX_ATTEMPTS,
  EVAT_RETRY_DELAYS_MINUTES,
  EVAT_STATUS_LABELS,
  EVAT_SUBMISSION_STATUSES,
  type EvatCertificate,
  evatDueAt,
  evatRetryDelayMinutes,
  isEvatOverdue,
} from './evat.ts'

const certificate: EvatCertificate = {
  providerInvoiceNumber: 'GRA-INV-0001',
  sdcId: 'SDC-1',
  serial: 'SER-1',
  signature: 'signature-bytes',
  internalData: 'internal-data',
  machineCode: 'MACHINE-1',
  stampedAt: '2026-10-27T09:00:00.000Z',
  qrPayload: 'https://example.test/verify?token=abc',
}

describe('E-VAT vocabulary', () => {
  it('lists the two document kinds and labels every submission status', () => {
    expect(EVAT_DOCUMENT_KINDS).toEqual(['INVOICE', 'REFUND'])
    expect(EVAT_SUBMISSION_STATUSES).toEqual([
      'QUEUED',
      'WAITING_FOR_INVOICE',
      'SUBMITTING',
      'CERTIFIED',
      'RETRY',
      'ATTENTION',
    ])
    for (const status of EVAT_SUBMISSION_STATUSES) {
      expect(EVAT_STATUS_LABELS[status].length).toBeGreaterThan(0)
      expect(EVAT_STATUS_LABELS[status]).not.toBe(status)
    }
  })

  it('names the GRA error codes we must handle', () => {
    expect(EVAT_ERROR_CODES).toEqual({
      ALREADY_SIGNED: 'E700',
      NOT_FOUND: 'E701',
      ALREADY_REFUNDED: 'E727',
      INVALID_SECURITY_KEY: 'E900',
    })
  })
})

describe('evatDueAt', () => {
  it('is 24 hours to the millisecond', () => {
    const occurredAt = new Date('2026-01-01T00:00:00.000Z')
    expect(EVAT_DEADLINE_HOURS).toBe(24)
    expect(evatDueAt(occurredAt).getTime()).toBe(occurredAt.getTime() + 24 * 60 * 60 * 1000)
  })
})

describe('evatRetryDelayMinutes', () => {
  it('is the published ladder, strictly increasing', () => {
    expect([...EVAT_RETRY_DELAYS_MINUTES]).toEqual([1, 2, 5, 15, 60, 240, 720])
    for (let attempt = 1; attempt < EVAT_RETRY_DELAYS_MINUTES.length; attempt += 1) {
      expect(evatRetryDelayMinutes(attempt + 1)).toBeGreaterThan(evatRetryDelayMinutes(attempt))
    }
  })

  it('is bounded at eight attempts and clamps beyond the ladder', () => {
    expect(EVAT_MAX_ATTEMPTS).toBe(8)
    expect(evatRetryDelayMinutes(EVAT_MAX_ATTEMPTS)).toBe(720)
    expect(evatRetryDelayMinutes(99)).toBe(720)
  })
})

describe('isEvatOverdue', () => {
  it('turns overdue one second after the deadline, not on it', () => {
    const dueAt = new Date('2026-01-02T00:00:00.000Z')
    expect(isEvatOverdue(dueAt, dueAt)).toBe(false)
    expect(isEvatOverdue(dueAt, new Date(dueAt.getTime() + 1000))).toBe(true)
    expect(isEvatOverdue(dueAt, new Date(dueAt.getTime() - 1000))).toBe(false)
  })
})

describe('certificateProblem', () => {
  it('accepts a complete certificate', () => {
    expect(certificateProblem(certificate)).toBeNull()
  })

  it('rejects each blank field by name', () => {
    for (const field of Object.keys(certificate) as Array<keyof EvatCertificate>) {
      const problem = certificateProblem({ ...certificate, [field]: '' })
      expect(problem).not.toBeNull()
      expect(problem).toContain(field)
    }
  })

  it('rejects each missing field by name', () => {
    for (const field of Object.keys(certificate) as Array<keyof EvatCertificate>) {
      const incomplete: Partial<EvatCertificate> = { ...certificate }
      delete incomplete[field]
      const problem = certificateProblem(incomplete)
      expect(problem).not.toBeNull()
      expect(problem).toContain(field)
    }
  })
})
