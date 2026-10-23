import type { Role } from '@gikautos/shared'
import { useSyncExternalStore } from 'react'
import type { LocalStaffBinding } from './bindings'

/**
 * The signed-in staff member for this app run.
 *
 * Deliberately **in memory only**: quitting the app signs the cashier out and
 * requires the PIN again (POS-03). The binding itself survives in the local
 * database, so the PIN works offline.
 */

export interface StaffSession {
  userId: string
  staffId: string
  name: string
  role: Role
  bindingId: string
  startedAt: string
}

let current: StaffSession | null = null
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

export function getStaffSession(): StaffSession | null {
  return current
}

export function startStaffSession(binding: LocalStaffBinding): StaffSession {
  current = {
    userId: binding.userId,
    staffId: binding.staffId,
    name: binding.name,
    role: binding.role,
    bindingId: binding.bindingId,
    startedAt: new Date().toISOString(),
  }
  emit()
  return current
}

export function endStaffSession(): void {
  current = null
  emit()
}

export function subscribeStaffSession(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** React hook: re-renders on sign-in/out. */
export function useStaffSession(): StaffSession | null {
  return useSyncExternalStore(subscribeStaffSession, getStaffSession, getStaffSession)
}

/** Non-React guard for services. */
export function requireStaffSession(): StaffSession {
  if (!current) throw new Error('No staff member is signed in')
  return current
}
