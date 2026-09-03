/**
 * Centralized ARROH REST client.
 *
 * The base URL is read from `VITE_API_BASE_URL` (via `.env`) and NEVER hardcoded
 * in components. Every service module calls `request<T>()` here so error
 * handling and timeouts stay in one place.
 */

import axios, { AxiosError, type AxiosRequestConfig } from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000';

/** A structured, user-actionable error with an optional technical detail. */
export class ApiError extends Error {
  /** HTTP status when the backend answered (undefined for network/timeout). */
  readonly status?: number;
  /** Raw `detail` payload — a string for most errors, an array for 422 validation. */
  readonly details?: unknown;
  /** Short, human-friendly message shown to non-technical users. */
  readonly friendly: string;

  constructor(friendly: string, status?: number, details?: unknown) {
    super(friendly);
    this.name = 'ApiError';
    this.friendly = friendly;
    this.status = status;
    this.details = details;
  }
}

/** Turn a FAILED_AXIOS/FAILED_FETCH (network) error into an ApiError. */
function mapTransportError(error: AxiosError): ApiError {
  if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
    return new ApiError(
      'The server took too long to respond. Check the backend connection and try again.',
    );
  }
  if (!error.response) {
    return new ApiError(
      'Unable to reach the backend. Confirm the ARROH server is running and this app has network access.',
    );
  }
  return mapHttpError(error.response.status, error.response.data);
}

/** Map backend `detail` (string or FastAPI validation array) to a friendly message. */
function mapHttpError(status: number, detail: unknown): ApiError {
  if (status === 400) return new ApiError('The request could not be processed as sent.', status, detail);
  if (status === 401) return new ApiError('Your session is not authorised. Please sign in again.', status, detail);
  if (status === 403) return new ApiError('You do not have permission to perform this action.', status, detail);
  if (status === 404) return new ApiError('The requested record was not found.', status, detail);
  if (status === 409) return new ApiError('This record already exists. Try a different value.', status, detail);
  if (status === 422) {
    return new ApiError(
      'Please check the required information and try again.',
      status,
      detail,
    );
  }
  if (status === 500) return new ApiError('The server encountered an error. Please try again later.', status, detail);
  if (status >= 500) return new ApiError('The server is unavailable right now. Try again shortly.', status, detail);
  return new ApiError('Something went wrong. Please try again.', status, detail);
}

const httpClient = axios.create({
  baseURL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

httpClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => Promise.reject(mapTransportError(error)),
);

/** Perform a typed request and return only the data payload. */
export async function request<T>(config: AxiosRequestConfig): Promise<T> {
  const response = await httpClient.request<T>(config);
  return response.data;
}

export const apiClient = httpClient;
