import { Redirect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { IS_DRIVE } from '@/lib/config';
import { useTheme } from '@/lib/theme';

// Entry: send each store app to its own home (MyRide → /customer, MyRide Drive → /drive), or to login.
export default function Index() {
  const { ready, token } = useAuth();
  const t = useTheme();
  if (!ready) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg }}><ActivityIndicator color={t.brand} size="large" /></View>;
  if (!token) return <Redirect href="/login" />;
  return <Redirect href={IS_DRIVE ? '/drive' : '/customer'} />;
}
