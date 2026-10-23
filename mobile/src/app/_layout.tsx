import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { StatusBar as RNStatusBar } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/lib/auth';
import { installCrashReporting } from '@/lib/crash';
import { useNotificationRouting } from '@/lib/push';

installCrashReporting();
// A crashing screen shows a "Try again" page (and is reported) instead of a blank app.
export { CrashScreen as ErrorBoundary } from '@/components/CrashScreen';

export default function RootLayout() {
  useNotificationRouting();
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        {/* Draw under the status bar (map and hero go edge to edge) on phones where Expo Go isn't edge-to-edge. */}
        <RNStatusBar translucent backgroundColor="transparent" />
        <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
