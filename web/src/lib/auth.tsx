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
import { getCurrentUser, loginUser, registerUser } from '../services/auth';
import { ApiError } from '../services/api';
import type { AuthUser, RegisterInput } from '../types';

interface Session {
  user: AuthUser | null;
  token: string | null;
}

const STORAGE_KEY = 'arroh.auth.session';

function readSession(): Session {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { user: null, token: null };
    const parsed = JSON.parse(raw) as Session;
    if (!parsed?.token || !parsed?.user?.email) return { user: null, token: null };
    return parsed;
  } catch {
    return { user: null, token: null };
  }
}

function writeSession(session: Session): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isAuthenticated: boolean;
  role: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string, role?: RegisterInput['role']) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>(() => readSession());

  useEffect(() => {
    const initial = readSession();
    if (!initial.token) return;
    let cancelled = false;
    getCurrentUser(initial.token)
      .then((user) => {
        if (cancelled) return;
        const next: Session = { user, token: initial.token };
        setSession(next);
        writeSession(next);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          setSession({ user: null, token: null });
          clearSession();
        }
      });
    return () => { cancelled = true; };
  }, []);

  const applySession = useCallback((next: Session) => {
    setSession(next);
    writeSession(next);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const response = await loginUser({ email, password });
      applySession({ user: response.user, token: response.token });
    },
    [applySession],
  );

  const register = useCallback(
    async (name: string, email: string, password: string, role: RegisterInput['role'] = 'doctor') => {
      const response = await registerUser({ name, email, password, role });
      applySession({ user: response.user, token: response.token });
    },
    [applySession],
  );

  const logout = useCallback(() => {
    setSession({ user: null, token: null });
    clearSession();
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session.user,
      token: session.token,
      isAuthenticated: session.user !== null && session.token !== null,
      role: session.user?.role ?? null,
      login,
      register,
      logout,
    }),
    [session, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

/** Guard: redirects unauthenticated staff to /login. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <>{children}</>;
}
