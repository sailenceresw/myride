import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from '@/lib/auth';
import { useNotificationRouting } from '@/lib/push';

export default function RootLayout() {
  useNotificationRouting();
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="auto" />
        <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
