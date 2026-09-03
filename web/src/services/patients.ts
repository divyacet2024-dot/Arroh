import { request } from './api';
import type { Patient, PatientCreate, PatientListParams, PatientTimelineResponse } from '../types';

const BASE = '/api/v1/patients';

/** GET /api/v1/patients/ — list patient records, optionally filtered. */
export function getPatients(params?: PatientListParams): Promise<Patient[]> {
  return request<Patient[]>({ method: 'GET', url: BASE + '/', params });
}

/** POST /api/v1/patients/ — register a new patient. */
export function registerPatient(data: PatientCreate): Promise<Patient> {
  return request<Patient>({ method: 'POST', url: BASE + '/', data });
}

/** GET /api/v1/patients/{patient_id} — fetch one patient by stable UUID. */
export function getPatient(patientId: string): Promise<Patient> {
  return request<Patient>({ method: 'GET', url: `${BASE}/${patientId}` });
}

/** GET /api/v1/patients/{patient_id}/timeline — longitudinal event feed. */
export function getPatientTimeline(patientId: string): Promise<PatientTimelineResponse> {
  return request<PatientTimelineResponse>({ method: 'GET', url: `${BASE}/${patientId}/timeline` });
}
