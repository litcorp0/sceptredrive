import { describe, expect, it } from 'vitest'
import { ApiError, DeviceRevokedError } from '../api/client'
import { classifySessionFailure, credentialProblemFor } from './session-state'

/**
 * The bug these tests pin: a terminal that was enrolled and whose token the server no longer
 * recognises was shown the first-install enrolment screen, as if it had never been enrolled.
 * `missing` is reserved for a terminal with no credential at all.
 */
describe('classifySessionFailure', () => {
  it('treats an explicit revocation as revoked', () => {
    expect(
      classifySessionFailure(new DeviceRevokedError(403, 'DEVICE_REVOKED', 'Device was revoked')),
    ).toBe('revoked')
  })

  it('treats an unrecognised token as rejected, never as a first install', () => {
    expect(
      classifySessionFailure(new ApiError(401, 'DEVICE_TOKEN_INVALID', 'Device token is invalid')),
    ).toBe('rejected')
    expect(
      classifySessionFailure(new ApiError(403, 'DEVICE_NOT_ENROLLED', 'Device is not enrolled')),
    ).toBe('rejected')
  })

  it('leaves an offline or server failure undecided', () => {
    expect(classifySessionFailure(new ApiError(0, 'NETWORK_ERROR', 'offline'))).toBe('unknown')
    expect(classifySessionFailure(new ApiError(500, 'INTERNAL', 'boom'))).toBe('unknown')
    expect(classifySessionFailure(new ApiError(429, 'RATE_LIMITED', 'slow down'))).toBe('unknown')
  })

  it('leaves a local failure (keychain) undecided', () => {
    expect(classifySessionFailure(new Error('OS encryption is unavailable'))).toBe('unknown')
    expect(classifySessionFailure(null)).toBe('unknown')
    expect(classifySessionFailure('not an error')).toBe('unknown')
  })
})

describe('credentialProblemFor', () => {
  it('shows a blocking screen only for a refused credential', () => {
    expect(credentialProblemFor('rejected')).toBe('rejected')
    expect(credentialProblemFor('revoked')).toBe('revoked')
  })

  it('lets a first install, an offline start and an active session through', () => {
    expect(credentialProblemFor('missing')).toBeNull()
    expect(credentialProblemFor('unknown')).toBeNull()
    expect(credentialProblemFor('active')).toBeNull()
  })
})
