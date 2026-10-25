import { request } from './api';
import type { AuthResponse, AuthUser, LoginInput, RegisterInput } from '../types';

const BASE = '/api/v1/auth';

/** POST /api/v1/auth/register — create a new clinician account. */
export function registerUser(data: RegisterInput): Promise<AuthResponse> {
  return request<AuthResponse>({ method: 'POST', url: `${BASE}/register`, data });
}

/** POST /api/v1/auth/login — authenticate an existing account. */
export function loginUser(data: LoginInput): Promise<AuthResponse> {
  return request<AuthResponse>({ method: 'POST', url: `${BASE}/login`, data });
}

/** GET /api/v1/auth/me — validate a stored token and refresh the user. */
export function getCurrentUser(token: string): Promise<AuthUser> {
  return request<AuthUser>({
    method: 'GET',
    url: `${BASE}/me`,
    headers: { Authorization: `Bearer ${token}` },
  });
}
