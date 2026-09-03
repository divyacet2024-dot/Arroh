import { request } from './api';
import type { QueueJoinRequest, QueuePatient, PrescriptionCreateRequest, PrescriptionResponse } from '../types';

const BASE = '/api/v1/teleconsult';

/** POST /api/v1/teleconsult/queue/join — add an assessed patient to a PHC queue. */
export function joinTeleconsultQueue(data: QueueJoinRequest): Promise<QueuePatient> {
  return request<QueuePatient>({ method: 'POST', url: `${BASE}/queue/join`, data });
}

/**
 * GET /api/v1/teleconsult/queue/next — claim the next priority patient.
 * `doctor_id` and `phc_id` are separate query parameters (never combined).
 * The backend may return null when the queue is empty.
 */
export function getNextPatient(params: { doctor_id: string; phc_id: string }): Promise<QueuePatient | null> {
  return request<QueuePatient | null>({ method: 'GET', url: `${BASE}/queue/next`, params });
}

/** POST /api/v1/teleconsult/prescription — issue a FHIR MedicationRequest. */
export function createPrescription(data: PrescriptionCreateRequest): Promise<PrescriptionResponse> {
  return request<PrescriptionResponse>({ method: 'POST', url: `${BASE}/prescription`, data });
}
