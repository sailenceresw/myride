import { router } from 'expo-router';
import { Alert } from 'react-native';
import { WebScreen } from '@/components/ui';
import { apiUrlFor, getApiToken } from '@/lib/api';

// Real-Time ID check (random selfie, like Uber). The token goes in the URL fragment, never to server logs.
export default function Selfie() {
  return (
    <WebScreen
      title="Selfie check"
      source={{ uri: `${apiUrlFor('/face-check.html')}#token=${encodeURIComponent(getApiToken() ?? '')}` }}
      onMessage={(e) => {
        try {
          const msg = JSON.parse(e.nativeEvent.data) as { type: string; passed: boolean; suspended?: boolean };
          if (msg.type !== 'face_check') return;
          if (msg.passed) router.back();
          else if (msg.suspended) Alert.alert('Account paused', 'We could not verify you. MyRide support will contact you.', [{ text: 'OK', onPress: () => router.back() }]);
        } catch { /* ignore non-JSON messages */ }
      }}
    />
  );
}
