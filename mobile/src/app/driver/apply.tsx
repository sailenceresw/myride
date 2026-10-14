import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Txt } from '@/components/ui';
import { apiUrlFor, getApiToken } from '@/lib/api';
import { useTheme } from '@/lib/theme';

// Driver KYC application (documents, bank, live selfie) runs in the MyRide Drive web wizard inside the app,
// signed in with the app's session — like Uber, where onboarding is web-based and driving is native.
export default function Apply() {
  const t = useTheme();
  const token = JSON.stringify(getApiToken() ?? '');
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12 }}>
        <Pressable onPress={() => router.back()} accessibilityLabel="Back"><Text style={{ fontSize: 24, color: t.ink }}>←</Text></Pressable>
        <Txt kind="h2">Driver application</Txt>
      </View>
      <WebView
        source={{ uri: apiUrlFor('/driver.html') }}
        injectedJavaScriptBeforeContentLoaded={`try { localStorage.setItem('myride.token.driver', ${token}); } catch (e) {} true;`}
        mediaCapturePermissionGrantType="grant"
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled
        domStorageEnabled
        style={{ flex: 1 }}
      />
    </SafeAreaView>
  );
}
