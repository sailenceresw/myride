import * as SecureStore from 'expo-secure-store';
import { router } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { api, ApiError, setApiToken } from './api';
import { VARIANT } from './config';
import { registerPush, unregisterPush } from './push';

// Each store app signs in to its own portal: MyRide → "rider", MyRide Drive → "driver" (separate sessions, like Uber).
const PORTAL = VARIANT === 'drive' ? 'driver' : 'rider'; // server portal names
/** Same key the web portals use, so the in-app WebView (KYC wizard) shares the session. */
export const TOKEN_KEY = `myride.token.${PORTAL}`;

const web = Platform.OS === 'web';
const storage = {
  get: async () => (web ? globalThis.localStorage?.getItem(TOKEN_KEY) ?? null : SecureStore.getItemAsync(TOKEN_KEY)),
  set: async (v: string) => (web ? globalThis.localStorage?.setItem(TOKEN_KEY, v) : SecureStore.setItemAsync(TOKEN_KEY, v)),
  del: async () => (web ? globalThis.localStorage?.removeItem(TOKEN_KEY) : SecureStore.deleteItemAsync(TOKEN_KEY)),
};

export type Profile = {
  id: string; name: string; phone: string; credits: number; firstRideFree: boolean;
  referral: { code: string; earned: number };
  membership: { active: boolean; label: string; expiresAt: number | null };
  driverApplication: { status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'resubmit' } | null; // rider application
  isDriver: boolean; // approved MyRide rider
  closeContacts?: { name: string; phone: string }[]; // people this customer shared trips with before
};

type AuthState = {
  ready: boolean;
  token: string | null;
  profile: Profile | null;
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

  // `keep` (refresh): re-fetch the profile without blanking it, so open screens don't unmount and flash.
  const load = useCallback(async (t: string | null, keep = false) => {
    setApiToken(t);
    setToken(t);
    if (!keep) setProfile(null);
    if (!t) return;
    try {
      const me = await api<{ portal: string; user: Profile }>('GET', '/api/me');
      if (me.portal !== PORTAL) throw new ApiError(403, 'wrong portal');
      setProfile(me.user);
      if (!keep) registerPush(); // once per sign-in / app start, not on every refresh
    } catch (e) {
      // Only a rejected session signs the user out — offline / server restarts keep the token.
      if (e instanceof ApiError && [401, 403].includes(e.status)) { await storage.del(); setApiToken(null); setToken(null); }
    }
  }, []);

  useEffect(() => { storage.get().then(load).finally(() => setReady(true)); }, [load]);

  const value = useMemo<AuthState>(() => ({
    ready, token, profile,
    requestOtp: (phone) => api('POST', '/api/auth/otp', { phone }),
    verifyOtp: async (phone, otp, name, referralCode) => {
      const r = await api<{ token: string }>('POST', '/api/auth/verify', { phone, otp, name, portal: PORTAL, referralCode: referralCode || undefined });
      await storage.set(r.token);
      await load(r.token);
    },
    refresh: () => load(token, true),
    signOut: async () => { await unregisterPush(); await storage.del(); await load(null); router.replace('/login'); },
  }), [ready, token, profile, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside AuthProvider');
  return v;
}
