import { request } from './api';
import type { EmergencyCallRequest, EmergencySessionResponse } from '../types';

/** POST /api/v1/voice-agent/emergency-session — start a trauma emergency voice session. */
export function emergencySession(data: EmergencyCallRequest): Promise<EmergencySessionResponse> {
  return request<EmergencySessionResponse>({ method: 'POST', url: '/api/v1/voice-agent/emergency-session', data });
}
