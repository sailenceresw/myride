import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { api } from './api';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

let current: string | null = null;

/**
 * Ask for permission and send this device's Expo push token to the server.
 * Silently does nothing where remote push isn't available (simulators, Expo Go on Android, no EAS projectId).
 */
export async function registerPush() {
  try {
    if (!Device.isDevice || Platform.OS === 'web') return;
    if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('trips', { name: 'Trips and offers', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 250, 250, 250] });
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;
    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    await api('POST', '/api/push/token', { token: data });
    current = data;
  } catch { /* push is a nice-to-have: the live event stream still works */ }
}

export async function unregisterPush() {
  if (current) await api('DELETE', '/api/push/token', { token: current }).catch(() => {});
  current = null;
}

/** Tapping a notification opens the screen it points at (`data.url`), including when it launched the app. */
export function useNotificationRouting() {
  const last = Notifications.useLastNotificationResponse();
  useEffect(() => {
    const url = last?.notification.request.content.data?.url;
    if (typeof url === 'string' && last?.actionIdentifier === Notifications.DEFAULT_ACTION_IDENTIFIER) router.push(url as Href);
  }, [last]);
}
