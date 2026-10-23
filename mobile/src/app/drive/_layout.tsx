import { Redirect, Stack } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { IS_DRIVE } from '@/lib/config';

// MyRide Drive (driver app) screens only: customer builds and signed-out users never land here (deep links, old notifications).
export default function DriveLayout() {
  const { ready, token } = useAuth();
  if (!IS_DRIVE) return <Redirect href="/" />;
  if (!ready) return null; // opened from a link or notification: wait for the saved sign-in before screens call the API
  if (!token) return <Redirect href="/login" />;
  return <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />;
}
