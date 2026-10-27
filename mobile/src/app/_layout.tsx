import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
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
        {/* SDK 58 apps are edge-to-edge: the map and heroes draw under the status bar (StatusBar `translucent` is gone). */}
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
