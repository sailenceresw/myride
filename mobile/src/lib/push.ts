import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { api } from './api';

// Expo Go has no (or an older) remote-push native module, so expo-notifications is only loaded in dev/store builds;
// if it still can't load (e.g. Expo Go 58 misses ExpoTopicSubscriptionModule), the app runs without push.
type NotificationsModule = typeof import('expo-notifications');
function loadNotifications(): NotificationsModule | null {
  if (Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return null;
  try {
    return require('expo-notifications'); // eslint-disable-line @typescript-eslint/no-require-imports
  } catch {
    return null;
  }
}
const N = loadNotifications();

N?.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let current: string | null = null;

/**
 * Ask for permission and send this device's Expo push token to the server.
 * Silently does nothing where remote push isn't available (Expo Go, simulators, no EAS projectId).
 */
export async function registerPush() {
  try {
    if (!N || !Device.isDevice) return;
    if (Platform.OS === 'android') await N.setNotificationChannelAsync('trips', { name: 'Trips and offers', importance: N.AndroidImportance.MAX, vibrationPattern: [0, 250, 250, 250] });
    const { status } = await N.requestPermissionsAsync();
    if (status !== 'granted') return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data } = await N.getExpoPushTokenAsync({ projectId });
    await api('POST', '/api/push/token', { token: data });
    current = data;
  } catch { /* push is a nice-to-have: the live event stream still works */ }
}

export async function unregisterPush() {
  if (current) await api('DELETE', '/api/push/token', { token: current }).catch(() => {});
  current = null;
}

/** Tapping a notification opens the screen it points at (`data.url`), including when it launched the app. */
export const useNotificationRouting = N
  ? function useNotificationRouting() {
    const last = N.useLastNotificationResponse();
    useEffect(() => {
      const url = last?.notification.request.content.data?.url;
      if (typeof url === 'string' && last?.actionIdentifier === N.DEFAULT_ACTION_IDENTIFIER) router.push(url as Href);
    }, [last]);
  }
  : () => {};
