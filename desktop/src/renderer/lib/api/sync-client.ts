import { apiRequest } from './client'
import type {
  DeviceConflictItem,
  DeviceSyncState,
  PosUploadRequest,
  PosUploadResponse,
} from './types'

/**
 * The device-facing sync endpoints (Plan 08 Task 2).
 *
 * The shared API client already performs the one allowed JWT refresh on 401 and
 * turns a revoked device into `DeviceRevokedError`, so the uploader only has to
 * classify the final outcome. Every call is bearer-authenticated; no cookies.
 */

export interface SyncClient {
  upload(request: PosUploadRequest): Promise<PosUploadResponse>
  conflicts(since?: string | null): Promise<DeviceConflictItem[]>
  state(): Promise<DeviceSyncState>
}

export const httpSyncClient: SyncClient = {
  upload(request) {
    return apiRequest<PosUploadResponse>('/api/pos/sync/upload', {
      method: 'POST',
      body: request,
      // A batch of 25 sales can take longer than a normal API call.
      timeoutMs: 60_000,
    })
  },

  async conflicts(since) {
    const query = new URLSearchParams({ limit: '100' })
    if (since) query.set('since', since)
    const response = await apiRequest<{ conflicts: DeviceConflictItem[] }>(
      `/api/pos/sync/conflicts?${query.toString()}`,
    )
    return response.conflicts
  },

  state() {
    return apiRequest<DeviceSyncState>('/api/pos/sync/state')
  },
}
