/**
 * Patient authentication context (mobile + OTP pathway).
 *
 * Completely separate from the doctor/staff AuthContext to avoid any
 * accidental privilege bleed between the two auth pathways.
 *
 * Security:
 *  - Token is stored under a separate localStorage key from staff auth.
 *  - On boot, the token is re-validated against /patient-auth/me.
 *    A 401 immediately clears the session (revoked/expired).
 *    A network error preserves the local session (offline-first).
 *  - The raw OTP is never stored anywhere in the frontend.
 *  - logout() clears the token synchronously.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Navigate } from 'react-router-dom';
import { getPatientMe, type PatientTokenUser } from '../services/patientAuth';
import { ApiError } from '../services/api';

interface PatientSession {
  user: PatientTokenUser | null;
  token: string | null;
}

const STORAGE_KEY = 'arroh.patient.session';

function readSession(): PatientSession {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { user: null, token: null };
    const parsed = JSON.parse(raw) as PatientSession;
    if (!parsed?.token || !parsed?.user?.phone_number) return { user: null, token: null };
    return parsed;
  } catch {
    return { user: null, token: null };
  }
}

function writeSession(s: PatientSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export interface PatientAuthContextValue {
  user: PatientTokenUser | null;
  token: string | null;
  isAuthenticated: boolean;
  /** Store a verified session after OTP success. */
  applySession: (user: PatientTokenUser, token: string) => void;
  /** Clear the session and return to the welcome screen. */
  logout: () => void;
}

const PatientAuthContext = createContext<PatientAuthContextValue | null>(null);

export function PatientAuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<PatientSession>(() => readSession());

  // Re-validate the persisted token once on boot.
  useEffect(() => {
    const initial = readSession();
    if (!initial.token) return;
    let cancelled = false;
    getPatientMe(initial.token)
      .then((user) => {
        if (cancelled) return;
        const next: PatientSession = { user, token: initial.token };
        setSession(next);
        writeSession(next);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Only clear on confirmed 401 — preserve session when offline.
        if (err instanceof ApiError && err.status === 401) {
          setSession({ user: null, token: null });
          clearSession();
        }
      });
    return () => { cancelled = true; };
  }, []);

  const applySession = useCallback((user: PatientTokenUser, token: string) => {
    const next: PatientSession = { user, token };
    setSession(next);
    writeSession(next);
  }, []);

  const logout = useCallback(() => {
    setSession({ user: null, token: null });
    clearSession();
  }, []);

  const value = useMemo<PatientAuthContextValue>(
    () => ({
      user: session.user,
      token: session.token,
      isAuthenticated: session.user !== null && session.token !== null,
      applySession,
      logout,
    }),
    [session, applySession, logout],
  );

  return (
    <PatientAuthContext.Provider value={value}>
      {children}
    </PatientAuthContext.Provider>
  );
}

export function usePatientAuth(): PatientAuthContextValue {
  const ctx = useContext(PatientAuthContext);
  if (!ctx) throw new Error('usePatientAuth must be used inside PatientAuthProvider');
  return ctx;
}

/** Route guard — redirects unauthenticated patients to the welcome screen. */
export function RequirePatient({ children }: { children: ReactNode }) {
  const { isAuthenticated } = usePatientAuth();
  if (!isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}
