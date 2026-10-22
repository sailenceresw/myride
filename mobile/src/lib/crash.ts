import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { apiUrlFor, getApiToken } from './api';
import { VARIANT } from './config';

// React Native's global error hook (not in the TypeScript lib types).
type ErrorUtilsType = { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void };
declare const ErrorUtils: ErrorUtilsType | undefined;

/** Send an error to MyRide's server (ops console → App errors). Never throws, never blocks. */
export function reportError(error: unknown, extra: { fatal?: boolean; screen?: string } = {}) {
  const e = error instanceof Error ? error : new Error(String(error));
  const token = getApiToken();
  fetch(apiUrlFor('/api/client-errors'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({
      app: VARIANT === 'drive' ? 'drive' : 'myride', version: Constants.expoConfig?.version ?? '', platform: `${Platform.OS} ${Platform.Version}`,
      fatal: !!extra.fatal, screen: extra.screen ?? '', message: e.message, stack: e.stack ?? '',
    }),
  }).catch(() => {});
}

let installed = false;
/** Report JavaScript errors that nothing caught (including fatal ones) before the default handler runs. */
export function installCrashReporting() {
  if (installed || typeof ErrorUtils === 'undefined') return;
  installed = true;
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, fatal) => {
    reportError(error, { fatal });
    previous(error, fatal);
  });
}
