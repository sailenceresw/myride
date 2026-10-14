import * as SecureStore from 'expo-secure-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { api, ApiError, setApiToken } from './api';
import { VARIANT } from './config';

// Each store app signs in to its own portal: MyRide → "rider", MyRide Drive → "driver" (separate sessions, like Uber).
const PORTAL = VARIANT === 'driver' ? 'driver' : 'rider';
const KEY = `myride.token.${PORTAL}`;

const storage = {
  get: async (k: string) => (Platform.OS === 'web' ? globalThis.localStorage?.getItem(k) ?? null : SecureStore.getItemAsync(k)),
  set: async (k: string, v: string) => (Platform.OS === 'web' ? globalThis.localStorage?.setItem(k, v) : SecureStore.setItemAsync(k, v)),
  del: async (k: string) => (Platform.OS === 'web' ? globalThis.localStorage?.removeItem(k) : SecureStore.deleteItemAsync(k)),
};

export type Profile = {
  id: string; name: string; phone: string; credits: number; firstRideFree: boolean;
  referral: { code: string; earned: number };
  membership: { active: boolean; label: string; expiresAt: number | null };
  driverApplication: { status: string } | null; isDriver: boolean;
};

type AuthState = {
  ready: boolean;
  token: string | null;
  profile: Profile | null;
  portal: string;
  requestOtp: (phone: string) => Promise<{ devOtp?: string }>;
  verifyOtp: (phone: string, otp: string, name: string, referralCode?: string) => Promise<void>;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const load = useCallback(async (t: string | null) => {
    setApiToken(t);
    setToken(t);
    if (!t) { setProfile(null); return; }
    try {
      const me = await api<{ portal: string; user: Profile }>('GET', '/api/me');
      if (me.portal !== PORTAL) throw new ApiError(403, 'wrong portal', {});
      setProfile(me.user);
    } catch (e) {
      // Only a rejected session signs the user out — offline / server restarts keep the token.
      if (!(e instanceof ApiError) || ![401, 403].includes(e.status)) return;
      await storage.del(KEY);
      setApiToken(null);
      setToken(null);
      setProfile(null);
    }
  }, []);

  useEffect(() => { storage.get(KEY).then((t) => load(t)).finally(() => setReady(true)); }, [load]);

  const value = useMemo<AuthState>(() => ({
    ready, token, profile, portal: PORTAL,
    requestOtp: (phone) => api('POST', '/api/auth/otp', { phone }),
    verifyOtp: async (phone, otp, name, referralCode) => {
      const r = await api<{ token: string }>('POST', '/api/auth/verify', { phone, otp, name, portal: PORTAL, referralCode: referralCode || undefined });
      await storage.set(KEY, r.token);
      await load(r.token);
    },
    refresh: () => load(token),
    signOut: async () => { await storage.del(KEY); await load(null); },
  }), [ready, token, profile, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
