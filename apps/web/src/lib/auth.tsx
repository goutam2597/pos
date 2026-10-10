import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ApiClient, ApiError, API_BASE } from './api';
import { getDeviceId, clearLocalData } from './db';
import { useI18n } from './i18n';
import type { Permission } from '@monopos/shared';

/**
 * Authentication state for the SPA.
 *
 * The access token is held in a module-level ref, never in React state and
 * never in localStorage: anything in `localStorage` is readable by any script
 * that gets injected, so a single XSS would otherwise yield a year-long token.
 * The refresh token is an httpOnly cookie the server owns.
 *
 * Because the token lives outside React state, `ApiClient` can read it through
 * a getter without the client object being rebuilt (and without re-rendering the
 * tree) whenever the token rotates.
 */

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string | null;
  locale: string;
  businessId: string;
  permissions: string[];
  branchIds: string[];
}

export interface AuthBusiness {
  id: string;
  name: string;
  currency: string;
  timezone: string;
  defaultLanguage: string;
}

interface AuthContextValue {
  status: 'loading' | 'authenticated' | 'anonymous';
  user: AuthUser | null;
  business: AuthBusiness | null;
  permissions: Set<string>;
  branchId: string | null;
  setBranchId: (id: string | null) => void;
  api: ApiClient;
  signIn: (email: string, password: string, registerId?: string) => Promise<void>;
  signOut: () => Promise<void>;
  can: (permission: Permission) => boolean;
  canAny: (...permissions: Permission[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

let accessToken: string | null = null;
let deviceId: string | null = null;
let activeBranchId: string | null = null;
let onSessionLost: (() => void) | null = null;

const BRANCH_KEY = 'monopos.branchId';

export function AuthProvider({ children }: { children: ReactNode }) {
  const { setLocale } = useI18n();
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [business, setBusiness] = useState<AuthBusiness | null>(null);
  const [branchId, setBranchIdState] = useState<string | null>(
    () => window.localStorage.getItem(BRANCH_KEY),
  );

  activeBranchId = branchId;

  const api = useMemo(
    () =>
      new ApiClient({
        baseUrl: API_BASE,
        getAccessToken: () => accessToken,
        onUnauthorized: () => {
          accessToken = null;
          setUser(null);
          setBusiness(null);
          setStatus('anonymous');
        },
        getDeviceId: () => deviceId,
        getBranchId: () => activeBranchId,
      }),
    [],
  );

  const setBranchId = useCallback((id: string | null) => {
    activeBranchId = id;
    setBranchIdState(id);
    if (id) window.localStorage.setItem(BRANCH_KEY, id);
    else window.localStorage.removeItem(BRANCH_KEY);
  }, []);

  const applySession = useCallback(
    (payload: {
      accessToken: string;
      user: AuthUser;
      business: AuthBusiness;
    }) => {
      accessToken = payload.accessToken;
      setUser(payload.user);
      setBusiness(payload.business);
      setStatus('authenticated');
      setLocale(payload.user.locale || payload.business.defaultLanguage);
      // A user with exactly one accessible branch should never have to pick it:
      // default to it unless they already chose otherwise. Without this the
      // till sits on "no branch selected" and no sale can complete.
      const stored = window.localStorage.getItem(BRANCH_KEY);
      if (!stored && payload.user.branchIds.length === 1) {
        const only = payload.user.branchIds[0]!;
        activeBranchId = only;
        setBranchIdState(only);
        window.localStorage.setItem(BRANCH_KEY, only);
      }
    },
    [setLocale],
  );

  // On boot: recover the device id, then try to exchange the refresh cookie
  // for a fresh access token. A failure here means "not signed in", not an error.
  const bootstrapped = useRef(false);
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;

    void (async () => {
      try {
        deviceId = await getDeviceId();
      } catch {
        deviceId = null;
      }

      // A throttled refresh (429) is not a dead session — the server is just
      // defending itself. Retry with backoff before showing the login page,
      // or a busy reload during a throttle window signs the operator out.
      let lastError: unknown = null;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const session = await api.post<{
            accessToken: string;
            user: AuthUser;
            business: AuthBusiness;
          }>('/auth/refresh', undefined, { noRetry: true });
          applySession(session);
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          const throttled = error instanceof ApiError && (error.status === 429 || error.status >= 500);
          if (!throttled) break;
          await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
        }
      }
      if (lastError !== null) setStatus('anonymous');
    })();
  }, [api, applySession]);

  const signIn = useCallback(
    async (email: string, password: string, registerId?: string) => {
      const session = await api.post<{
        accessToken: string;
        user: AuthUser;
        business: AuthBusiness;
      }>('/auth/login', { email, password, registerId }, { noRetry: true });
      applySession(session);
    },
    [api, applySession],
  );

  const signOut = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch (error) {
      // A failed logout call must still clear the client — the user asked to
      // leave, and leaving them "signed in" on a shared till is worse.
      if (!(error instanceof ApiError)) throw error;
    }
    accessToken = null;
    setUser(null);
    setBusiness(null);
    setStatus('anonymous');
    await clearLocalData().catch(() => undefined);
  }, [api]);

  const permissions = useMemo(() => new Set(user?.permissions ?? []), [user]);

  const can = useCallback((permission: Permission) => permissions.has(permission), [permissions]);
  const canAny = useCallback(
    (...list: Permission[]) => list.some((p) => permissions.has(p)),
    [permissions],
  );

  useEffect(() => {
    onSessionLost = () => setStatus('anonymous');
    return () => {
      onSessionLost = null;
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      business,
      permissions,
      branchId,
      setBranchId,
      api,
      signIn,
      signOut,
      can,
      canAny,
    }),
    [status, user, business, permissions, branchId, setBranchId, api, signIn, signOut, can, canAny],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
