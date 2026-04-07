import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren
} from 'react';

import { getAuthSession, logout, refreshSession, startWebLogin } from '../api/auth';
import { AuthExpiredError, ApiError } from '../api/client';
import { getMe } from '../api/me';
import type { MeResponse } from '../api/types';
import { queryClient } from './query-client';

type AuthStatus = 'booting' | 'anonymous' | 'authenticated' | 'error';

interface AuthContextValue {
  status: AuthStatus;
  me: MeResponse | null;
  errorMessage: string | null;
  refreshBootstrap: () => Promise<void>;
  beginLogin: (returnTo?: string) => Promise<void>;
  logoutUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readCookie(name: string): string | null {
  const prefix = `${name}=`;

  for (const segment of document.cookie.split(';')) {
    const trimmed = segment.trim();
    if (!trimmed.startsWith(prefix)) {
      continue;
    }

    try {
      return decodeURIComponent(trimmed.slice(prefix.length));
    } catch {
      return trimmed.slice(prefix.length);
    }
  }

  return null;
}

function hasBrowserSessionHint(): boolean {
  return Boolean(readCookie('mlfg_csrf'));
}

function describeError(error: unknown): string {
  if (error instanceof AuthExpiredError) {
    return error.message;
  }

  if (error instanceof ApiError) {
    return error.message;
  }

  return 'Unexpected client error';
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthStatus>('booting');
  const [me, setMe] = useState<MeResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const refreshBootstrap = useCallback(async () => {
    setStatus('booting');
    setErrorMessage(null);

    try {
      let session = await getAuthSession();

      if (!session.authenticated && hasBrowserSessionHint()) {
        try {
          await refreshSession();
          session = await getAuthSession();
        } catch {
          // Treat failed refresh as an anonymous browser session and continue.
        }
      }

      if (!session.authenticated) {
        setMe(null);
        queryClient.removeQueries({ queryKey: ['me'] });
        setStatus('anonymous');
        return;
      }

      const mePayload = await getMe();
      queryClient.setQueryData(['me'], mePayload);
      setMe(mePayload);
      setStatus('authenticated');
    } catch (error) {
      if (error instanceof AuthExpiredError) {
        setMe(null);
        setStatus('anonymous');
        return;
      }

      setMe(null);
      setStatus('error');
      setErrorMessage(describeError(error));
    }
  }, []);

  useEffect(() => {
    void refreshBootstrap();
  }, [refreshBootstrap]);

  const beginLogin = useCallback(async (returnTo = '/app/parties') => {
    const result = await startWebLogin(returnTo);
    window.location.assign(result.authorizeUrl);
  }, []);

  const logoutUser = useCallback(async () => {
    await logout();
    queryClient.clear();
    setMe(null);
    setStatus('anonymous');
    setErrorMessage(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    me,
    errorMessage,
    refreshBootstrap,
    beginLogin,
    logoutUser
  }), [errorMessage, me, refreshBootstrap, beginLogin, logoutUser, status]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider');
  }

  return context;
}
