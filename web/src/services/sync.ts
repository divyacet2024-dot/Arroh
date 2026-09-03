import { request } from './api';
import type { SyncPayload, SyncResponse, SmsFallbackRequest, SmsFallbackResponse } from '../types';

/** POST /api/v1/sync/bulk — reconcile a queued offline batch. */
export function bulkSync(data: SyncPayload): Promise<SyncResponse> {
  return request<SyncResponse>({ method: 'POST', url: '/api/v1/sync/bulk', data });
}

/** POST /api/v1/sync/sms-fallback — dispatch a compressed zero-internet emergency record. */
export function smsFallback(data: SmsFallbackRequest): Promise<SmsFallbackResponse> {
  return request<SmsFallbackResponse>({ method: 'POST', url: '/api/v1/sync/sms-fallback', data });
}
