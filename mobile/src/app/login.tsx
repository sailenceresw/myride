import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Txt } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { IS_DRIVER } from '@/lib/config';
import { useTheme } from '@/lib/theme';

const PHONE_RE = /^9[678]\d{8}$/;

export default function Login() {
  const t = useTheme();
  const { requestOtp, verifyOtp } = useAuth();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [referral, setReferral] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [devOtp, setDevOtp] = useState<string | undefined>();
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown(cooldown - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function send() {
    setErr('');
    if (!PHONE_RE.test(phone)) return setErr('Enter your 10-digit Nepali mobile number (98XXXXXXXX)');
    setBusy(true);
    try {
      const r = await requestOtp(phone);
      setDevOtp(r.devOtp);
      setStep('code');
      setCooldown(60);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  async function verify() {
    setErr('');
    if (otp.length !== 6) return setErr('Enter the 6-digit code from the SMS');
    setBusy(true);
    try {
      await verifyOtp(phone, otp, name, referral);
      router.replace('/');
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  const input = [styles.input, { borderColor: t.line, color: t.ink, backgroundColor: t.card }];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 22, gap: 10 }} keyboardShouldPersistTaps="handled">
          <View style={[styles.logo, { backgroundColor: t.brand }]}><Text style={styles.logoText}>My</Text></View>
          <Txt kind="h1">{IS_DRIVER ? 'MyRide Drive' : 'MyRide'}</Txt>
          <Txt kind="muted">{IS_DRIVER ? 'Drive, deliver and haul in Pokhara. Weekly payouts to your bank.' : 'Rides, parcels and logistics across all 33 wards of Pokhara.'}</Txt>

          {step === 'phone' ? (
            <>
              <Txt kind="small" style={{ marginTop: 16 }}>Mobile number</Txt>
              <View style={[styles.phoneRow, { borderColor: t.line, backgroundColor: t.card }]}>
                <Text style={{ color: t.muted, fontSize: 17 }}>🇳🇵 +977</Text>
                <TextInput
                  value={phone}
                  onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))}
                  keyboardType="phone-pad"
                  textContentType="telephoneNumber"
                  autoComplete="tel"
                  placeholder="98XXXXXXXX"
                  placeholderTextColor={t.muted}
                  style={{ flex: 1, fontSize: 18, color: t.ink, paddingVertical: 12 }}
                  accessibilityLabel="Mobile number"
                />
              </View>
              <Txt kind="small">{"We'll send a 6-digit code by SMS."}</Txt>
              <Button title="Continue" onPress={send} loading={busy} />
            </>
          ) : (
            <>
              <Txt kind="muted" style={{ marginTop: 16 }}>Enter the code sent to +977 {phone}</Txt>
              <TextInput
                value={otp}
                onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                autoFocus
                maxLength={6}
                placeholder="••••••"
                placeholderTextColor={t.muted}
                style={[...input, { fontSize: 28, letterSpacing: 10, textAlign: 'center', fontWeight: '800' }]}
                accessibilityLabel="SMS code"
              />
              {devOtp && <Txt kind="small">Development mode (no SMS gateway) — your code is {devOtp}</Txt>}
              <TextInput value={name} onChangeText={setName} placeholder="Your name (new accounts)" placeholderTextColor={t.muted} style={input} autoComplete="name" textContentType="name" />
              {!IS_DRIVER && <TextInput value={referral} onChangeText={(v) => setReferral(v.toUpperCase())} placeholder="Friend's referral code (optional)" placeholderTextColor={t.muted} style={input} autoCapitalize="characters" maxLength={8} />}
              <Button title="Verify & continue" onPress={verify} loading={busy} />
              <Button title={cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'} kind="ghost" disabled={cooldown > 0 || busy} onPress={send} />
              <Button title="Change number" kind="ghost" onPress={() => { setStep('phone'); setOtp(''); }} />
            </>
          )}
          {!!err && <Text style={{ color: t.danger, fontSize: 14 }}>{err}</Text>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  logo: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
  logoText: { color: '#fff', fontWeight: '900', fontSize: 22 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
});
