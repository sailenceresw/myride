import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { BackHeader, Button, Icon, Txt } from '@/components/ui';
import { useTheme } from '@/lib/theme';

/** What the server returns to start a payment (POST /api/trips/:id/pay or /api/membership/checkout). */
export type PayInit =
  | { provider: 'esewa'; action: string; fields: Record<string, string> }
  | { provider: 'khalti'; payment_url?: string; sandboxUnavailable?: boolean; message?: string }
  | { provider: 'sandbox' };
/** Where the server's payment callback sends the browser: /?payment=<result>. */
export type PayResult = 'paid' | 'membership_active' | 'failed' | 'amount_mismatch' | 'unknown' | 'cancelled';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
// eSewa takes a signed form POST: an auto-submitting page posts it from inside the WebView.
const esewaPage = (action: string, fields: Record<string, string>) =>
  `<!doctype html><html><body onload="document.forms[0].submit()" style="font-family:sans-serif;text-align:center;padding-top:40vh;color:#555">
  Opening eSewa…<form method="POST" action="${esc(action)}">${Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}</form></body></html>`;

/**
 * eSewa / Khalti checkout inside the app. The provider's own page handles the wallet login and PIN (MyRide never
 * sees them); when it finishes, the server verifies the payment with the provider and redirects to /?payment=…,
 * which this screen catches to report the result.
 */
export function PayScreen({ visible, title, start, onResult, onClose }: {
  visible: boolean; title: string; start: () => Promise<PayInit>; onResult: (r: PayResult) => void; onClose: () => void;
}) {
  const t = useTheme();
  const [init, setInit] = useState<PayInit | null>(null);
  const [err, setErr] = useState('');
  const finished = useRef(false); // the result URL can reach both WebView callbacks: report it once

  useEffect(() => {
    if (!visible) return;
    finished.current = false;
    let live = true;
    start().then((r) => {
      if (!live) return;
      if (r.provider === 'sandbox') { onResult('membership_active'); onClose(); return; } // development test checkout
      setInit(r);
    }).catch((e) => live && setErr((e as Error).message));
    return () => { live = false; setInit(null); setErr(''); };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps -- start once each time the screen opens

  const done = (url: string) => {
    const m = /[?&]payment=([a-z_]+)/.exec(url);
    if (!m) return false;
    if (!finished.current) { finished.current = true; onResult(m[1] as PayResult); onClose(); }
    return true;
  };

  const source = init?.provider === 'esewa' ? { html: esewaPage(init.action, init.fields) }
    : init?.provider === 'khalti' && init.payment_url ? { uri: init.payment_url } : null;
  const unavailable = init?.provider === 'khalti' && !init.payment_url ? init.message ?? 'Khalti is not available right now.' : '';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => { onResult('cancelled'); onClose(); }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ paddingHorizontal: 12 }}><BackHeader title={title} onBack={() => { onResult('cancelled'); onClose(); }} /></View>
        {err || unavailable ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
            <Icon name="alert-circle-outline" size={48} color={t.danger} />
            <Txt kind="muted" style={{ textAlign: 'center' }}>{err || unavailable}</Txt>
            <Button title="Close" kind="soft" onPress={onClose} style={{ alignSelf: 'stretch' }} />
          </View>
        ) : source ? (
          <WebView
            source={source}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            startInLoadingState
            onShouldStartLoadWithRequest={(req) => !done(req.url)}
            onNavigationStateChange={(nav) => { done(nav.url); }}
            style={{ flex: 1 }}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={t.brand} size="large" /></View>
        )}
      </SafeAreaView>
    </Modal>
  );
}
