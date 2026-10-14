import { router } from 'expo-router';
import { Alert, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { Txt } from '@/components/ui';
import { apiUrlFor, getApiToken } from '@/lib/api';
import { useTheme } from '@/lib/theme';

// Real-Time ID check (random selfie, like Uber). The token goes in the URL fragment, never to server logs.
export default function Selfie() {
  const t = useTheme();
  const uri = `${apiUrlFor('/face-check.html')}#token=${encodeURIComponent(getApiToken() ?? '')}`;
  function onMessage(e: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(e.nativeEvent.data) as { type: string; passed: boolean; suspended?: boolean };
      if (msg.type !== 'face_check') return;
      if (msg.passed) router.back();
      else if (msg.suspended) Alert.alert('Account paused', 'We could not verify you. MyRide support will contact you.', [{ text: 'OK', onPress: () => router.back() }]);
    } catch { /* ignore */ }
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 }}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back"><Text style={{ fontSize: 24, color: t.ink }}>←</Text></Pressable>
        <Txt kind="h2">Selfie check</Txt>
      </View>
      <WebView source={{ uri }} onMessage={onMessage} mediaCapturePermissionGrantType="grant" allowsInlineMediaPlayback mediaPlaybackRequiresUserAction={false} javaScriptEnabled style={{ flex: 1 }} />
    </SafeAreaView>
  );
}
