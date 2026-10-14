import Constants from 'expo-constants';
import { Platform } from 'react-native';

export type Variant = 'rider' | 'driver';
const extra = (Constants.expoConfig?.extra ?? {}) as { variant?: Variant; apiUrl?: string | null };

/** Which store app this build is: MyRide (rider) or MyRide Drive (driver). */
export const VARIANT: Variant = (process.env.EXPO_PUBLIC_APP_VARIANT as Variant) || extra.variant || 'rider';
export const IS_DRIVER = VARIANT === 'driver';

/**
 * MyRide API base URL.
 * 1. EXPO_PUBLIC_API_URL / app config (production: https://api.myride.com.np)
 * 2. In development: same machine as the Expo dev server (works for real phones on Wi-Fi with Expo Go),
 *    the Android emulator alias 10.0.2.2, or localhost for the iOS simulator / web.
 */
export function apiUrl(): string {
  // Expo Go can hand back non-string `extra` values — only accept a real http(s) URL.
  const configured = [process.env.EXPO_PUBLIC_API_URL, extra.apiUrl].find((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u));
  if (configured) return configured.replace(/\/$/, '');
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host && host !== 'localhost' && host !== '127.0.0.1') return `http://${host}:3000`;
  if (Platform.OS === 'android') return 'http://10.0.2.2:3000';
  return 'http://localhost:3000';
}

export const POKHARA = { latitude: 28.2096, longitude: 83.9856 };
export const SAFETY = { police: '100', touristPolice: '1144', ambulance: '102' };
