import { request } from './api';
import type { TriageRequest, TriageResult, FormatTriageRequest, FormatTriageResponse } from '../types';

/** POST /api/v1/triage/assess — offline-capable edge triage assessment. */
export function assessTriage(data: TriageRequest): Promise<TriageResult> {
  return request<TriageResult>({ method: 'POST', url: '/api/v1/triage/assess', data });
}

/** POST /api/v1/accessibility/format-triage — reshape triage for a communication mode. */
export function formatTriage(data: FormatTriageRequest): Promise<FormatTriageResponse> {
  return request<FormatTriageResponse>({
    method: 'POST',
    url: '/api/v1/accessibility/format-triage',
    data,
  });
}
