import { request } from './api';

export interface Consultation {
  id: string;
  patient_id: string;
  referral_id?: string | null;
  doctor_id: string;
  status: string;
  chief_complaint?: string | null;
  history?: string | null;
  findings?: string | null;
  vitals: Record<string, number | string>;
  assessment?: string | null;
  clinical_impression?: string | null;
  treatment_plan?: string | null;
}

export function startConsultation(data: Omit<Consultation, 'id' | 'status'>): Promise<Consultation> {
  return request<Consultation>({ method: 'POST', url: '/api/v1/consultations', data });
}

export function completeConsultation(id: string, doctorId: string): Promise<Consultation> {
  return request<Consultation>({ method: 'POST', url: `/api/v1/consultations/${id}/complete`, data: { doctor_id: doctorId } });
}

export function createDischarge(data: Record<string, unknown>) {
  return request<Record<string, unknown>>({ method: 'POST', url: '/api/v1/consultations/discharge', data });
}
