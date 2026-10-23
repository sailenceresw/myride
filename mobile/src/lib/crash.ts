import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { apiUrlFor, getApiToken } from './api';
import { VARIANT } from './config';

// React Native's global error hook (not in the TypeScript lib types).
type ErrorUtilsType = { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void };
declare const ErrorUtils: ErrorUtilsType | undefined;

const PENDING_KEY = 'myride.pendingCrash';
const payload = (error: unknown, extra: { fatal?: boolean; screen?: string }) => {
  const e = error instanceof Error ? error : new Error(String(error));
  return {
    app: VARIANT === 'drive' ? 'drive' : 'myride', version: Constants.expoConfig?.version ?? '', platform: `${Platform.OS} ${Platform.Version}`,
    fatal: !!extra.fatal, screen: extra.screen ?? '', message: e.message.slice(0, 300), stack: (e.stack ?? '').slice(0, 1200),
  };
};
const send = (body: object) => {
  const token = getApiToken();
  return fetch(apiUrlFor('/api/client-errors'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
};

/** Send an error to MyRide's server (ops console → App errors). Never throws, never blocks. */
export function reportError(error: unknown, extra: { fatal?: boolean; screen?: string } = {}) {
  send(payload(error, extra)).catch(() => {});
}

let installed = false;
/**
 * Report JavaScript errors that nothing caught. A fatal one ends the app before a request could leave, so it is
 * first saved on the phone (synchronously) and sent on the next launch.
 */
export function installCrashReporting() {
  if (installed || typeof ErrorUtils === 'undefined') return;
  installed = true;
  try {
    const pending = Platform.OS === 'web' ? null : SecureStore.getItem(PENDING_KEY);
    if (pending) send(JSON.parse(pending)).then(() => SecureStore.deleteItemAsync(PENDING_KEY)).catch(() => {});
  } catch { /* nothing saved, or storage unavailable */ }
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, fatal) => {
    const body = payload(error, { fatal });
    if (fatal && Platform.OS !== 'web') { try { SecureStore.setItem(PENDING_KEY, JSON.stringify(body)); } catch { /* best effort */ } }
    send(body).then(() => { if (fatal) SecureStore.deleteItemAsync(PENDING_KEY).catch(() => {}); }).catch(() => {});
    previous(error, fatal);
  });
}
