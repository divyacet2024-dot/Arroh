import { request } from './api';
import type { VoiceParseRequest, VoiceParseResponse } from '../types';

/** POST /api/v1/voice/parse-and-triage — parse spoken intake then assess triage. */
export function voiceTriage(data: VoiceParseRequest): Promise<VoiceParseResponse> {
  return request<VoiceParseResponse>({ method: 'POST', url: '/api/v1/voice/parse-and-triage', data });
}
