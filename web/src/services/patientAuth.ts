/**
 * Patient mobile-OTP authentication service.
 * Wires the frontend to the real backend endpoints in patient_auth.py.
 *
 * Security:
 *  - raw OTP never stored — only submitted once for verification
 *  - dev_otp field only appears in development builds (backend strips it in prod)
 *  - token stored in patientAuth context, never in cookies or plain localStorage key
 */
import { request } from './api';

const BASE = '/api/v1/patient-auth';

export interface OtpRequestResponse {
  message: string;
  resend_after_seconds: number;
  /** Only present in development. NEVER display in production UI. */
  dev_otp?: string | null;
}

export interface PatientTokenUser {
  id: string;
  phone_number: string;
  name: string | null;
  role: 'patient';
}

export interface PatientAuthResponse {
  token: string;
  token_type: string;
  user: PatientTokenUser;
}

export interface OtpErrorDetail {
  code: string;
  message: string;
  resend_after_seconds?: number;
}

/** Request an OTP for the given normalised phone number. */
export function requestOtp(phone_number: string): Promise<OtpRequestResponse> {
  return request<OtpRequestResponse>({ method: 'POST', url: `${BASE}/request-otp`, data: { phone_number } });
}

/** Verify the 6-digit OTP and receive a patient session token on success. */
export function verifyOtp(phone_number: string, otp_code: string): Promise<PatientAuthResponse> {
  return request<PatientAuthResponse>({ method: 'POST', url: `${BASE}/verify-otp`, data: { phone_number, otp_code } });
}

/** Validate a stored patient token and refresh the patient identity. */
export function getPatientMe(token: string): Promise<PatientTokenUser> {
  return request<PatientTokenUser>({
    method: 'GET',
    url: `${BASE}/me`,
    headers: { Authorization: `Bearer ${token}` },
  });
}
