import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';

export type Variant = 'customer' | 'drive';
const extra = (Constants.expoConfig?.extra ?? {}) as { variant?: Variant; apiUrl?: unknown };

/** Which store app this build is: MyRide (customers book trips) or MyRide Drive (riders drive and earn). */
export const VARIANT: Variant = (process.env.EXPO_PUBLIC_APP_VARIANT as Variant) || extra.variant || 'customer';
export const IS_DRIVE = VARIANT === 'drive';

/**
 * MyRide API base URL, resolved once:
 * 1. EXPO_PUBLIC_API_URL / app config (production: https://api.myride.com.np)
 * 2. Development: the Expo dev server's machine (real phones on Wi-Fi), 10.0.2.2 (Android emulator) or localhost.
 */
function resolveApiUrl(): string {
  // Expo Go can hand back non-string `extra` values — only accept a real http(s) URL.
  const configured = [process.env.EXPO_PUBLIC_API_URL, extra.apiUrl].find((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u));
  if (configured) return configured.replace(/\/$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1') return `http://${host}:3000`;
  return Platform.OS === 'android' ? 'http://10.0.2.2:3000' : 'http://localhost:3000';
}
export const API_URL = resolveApiUrl();

export const POKHARA = { latitude: 28.2096, longitude: 83.9856 };
export const POLICE = '100';
/** Nepal mobile: 98x/97x (NTC, Ncell), 96x (Smart) — same rule as the server. */
export const PHONE_RE = /^9[678]\d{8}$/;
export const call = (phone?: string) => phone && Linking.openURL(`tel:${phone}`);
