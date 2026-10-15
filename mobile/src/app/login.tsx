import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Hero, Icon, Pill, Row, Txt, type IconName } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { IS_DRIVE, PHONE_RE } from '@/lib/config';
import { shadow, useTheme } from '@/lib/theme';

const PERKS: [IconName, string][] = IS_DRIVE
  ? [['wallet-outline', 'Weekly payouts'], ['shield-checkmark-outline', 'Verified customers'], ['time-outline', 'Your hours']]
  : [['pricetag-outline', 'No surge'], ['map-outline', 'All 33 wards'], ['gift-outline', 'First ride free']];

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
  const [toRider, setToRider] = useState(false); // customer app: continue to the rider application after sign-in

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
      if (!toRider) return router.replace('/');
      router.replace('/customer');
      router.push('/customer/apply');
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  const input = [styles.input, { borderColor: t.line, color: t.ink, backgroundColor: t.bg }];
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ flexGrow: 1 }}>
          <Hero style={{ paddingBottom: 56 }}>
            <Logo />
            <Text style={styles.brand}>{IS_DRIVE ? 'MyRide Drive' : 'MyRide'}</Text>
            <Text style={styles.tagline}>{IS_DRIVE ? 'Drive, deliver and haul in Pokhara.' : 'Rides, parcels and logistics across Pokhara.'}</Text>
            <Row style={{ flexWrap: 'wrap', marginTop: 16 }}>
              {PERKS.map(([icon, text]) => <View key={text} style={styles.perk}><Icon name={icon} size={14} color="#fff" /><Text style={styles.perkText}>{text}</Text></View>)}
            </Row>
          </Hero>

          <View style={[styles.form, shadow(10), { backgroundColor: t.card }]}>
            {step === 'phone' ? (
              <>
                <Txt kind="h2">Enter your mobile number</Txt>
                <Txt kind="muted">{"We'll text you a 6-digit code."}</Txt>
                <View style={[styles.phoneRow, { borderColor: phone.length === 10 ? t.brand : t.line, backgroundColor: t.bg }]}>
                  <Text style={{ fontSize: 18 }}>🇳🇵</Text>
                  <Text style={{ color: t.ink, fontSize: 17, fontWeight: '700' }}>+977</Text>
                  <View style={{ width: 1, height: 24, backgroundColor: t.line }} />
                  <TextInput
                    value={phone}
                    onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))}
                    keyboardType="phone-pad"
                    textContentType="telephoneNumber"
                    autoComplete="tel"
                    placeholder="98XXXXXXXX"
                    placeholderTextColor={t.muted}
                    style={{ flex: 1, fontSize: 19, fontWeight: '600', color: t.ink, paddingVertical: 14, letterSpacing: 1 }}
                    accessibilityLabel="Mobile number"
                  />
                </View>
                <Button title="Continue" icon="arrow-forward" onPress={send} loading={busy} disabled={phone.length !== 10} />
              </>
            ) : (
              <>
                <Txt kind="h2">Enter the code</Txt>
                <Txt kind="muted">Sent by SMS to +977 {phone}</Txt>
                <CodeBoxes value={otp} onChange={setOtp} />
                {devOtp && <Pill icon="construct-outline" text={`Dev mode · code ${devOtp}`} color={t.accent} tint={t.accentSoft} />}
                <TextInput value={name} onChangeText={setName} placeholder="Your name (new accounts)" placeholderTextColor={t.muted} style={input} autoComplete="name" textContentType="name" />
                {!IS_DRIVE && <TextInput value={referral} onChangeText={(v) => setReferral(v.toUpperCase())} placeholder="Friend's referral code (optional)" placeholderTextColor={t.muted} style={input} autoCapitalize="characters" maxLength={8} />}
                <Button title="Verify & continue" icon="checkmark" onPress={verify} loading={busy} disabled={otp.length !== 6} />
                <Row>
                  <Button title={cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'} kind="ghost" disabled={cooldown > 0 || busy} onPress={send} style={{ flex: 1 }} />
                  <Button title="Change number" kind="ghost" onPress={() => { setStep('phone'); setOtp(''); }} style={{ flex: 1 }} />
                </Row>
              </>
            )}
            {!!err && <Row><Icon name="alert-circle" size={18} color={t.danger} /><Text style={{ color: t.danger, fontSize: 14, flex: 1 }}>{err}</Text></Row>}
          </View>

          {!IS_DRIVE && (
            <Pressable onPress={() => setToRider(!toRider)} accessibilityRole="checkbox" accessibilityState={{ checked: toRider }} style={[styles.earn, { backgroundColor: t.card, borderColor: toRider ? t.brand : t.line }]}>
              <Text style={{ fontSize: 30 }}>🏍️</Text>
              <View style={{ flex: 1 }}>
                <Txt style={{ fontWeight: '800' }}>Want to earn with MyRide?</Txt>
                <Txt kind="small">{toRider ? "After signing in you'll go straight to the rider application." : 'Apply to become a rider with your motorcycle, car or van.'}</Txt>
              </View>
              <Icon name={toRider ? 'checkbox' : 'square-outline'} size={24} color={toRider ? t.brand : t.muted} />
            </Pressable>
          )}

          <Row style={{ justifyContent: 'center', marginTop: 'auto', paddingVertical: 20, paddingHorizontal: 16 }}>
            <Icon name="lock-closed" size={13} color={t.muted} />
            <Txt kind="small">Your number is only shared with your {IS_DRIVE ? 'customer' : 'rider'} during a trip</Txt>
          </Row>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** App mark: a navigation arrow on a white tile (teal for MyRide, ink for MyRide Drive). */
export function Logo({ size = 60 }: { size?: number }) {
  const t = useTheme();
  return (
    <View style={[styles.logo, shadow(6), { width: size, height: size, borderRadius: size * 0.28 }]}>
      <Icon name="navigate" size={size * 0.52} color={IS_DRIVE ? '#101a19' : t.brand} />
    </View>
  );
}

/** Six code boxes drawn under one transparent input (keeps SMS auto-fill and paste working). */
function CodeBoxes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const t = useTheme();
  return (
    <View style={{ marginVertical: 6 }}>
      <Row style={{ justifyContent: 'space-between' }}>
        {Array.from({ length: 6 }, (_, i) => (
          <View key={i} style={[styles.box, { borderColor: i === value.length ? t.brand : value[i] ? t.ink : t.line, backgroundColor: t.bg }]}>
            <Text style={{ fontSize: 24, fontWeight: '800', color: t.ink }}>{value[i] ?? ''}</Text>
          </View>
        ))}
      </Row>
      <TextInput
        value={value}
        onChangeText={(v) => onChange(v.replace(/\D/g, '').slice(0, 6))}
        keyboardType="number-pad"
        textContentType="oneTimeCode"
        autoComplete="sms-otp"
        autoFocus
        maxLength={6}
        caretHidden
        style={[StyleSheet.absoluteFill, { opacity: 0.011 }]} // invisible but still focusable (Android ignores a transparent text colour)
        accessibilityLabel="SMS code"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  logo: { backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  brand: { color: '#fff', fontSize: 34, fontWeight: '900', letterSpacing: -0.5 },
  tagline: { color: '#ffffffd0', fontSize: 15, marginTop: 4 },
  perk: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#ffffff22', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 6 },
  perkText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  form: { marginHorizontal: 16, marginTop: -32, borderRadius: 24, padding: 20, gap: 12 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14 },
  input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16 },
  box: { width: 46, height: 56, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  earn: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 14, borderRadius: 20, borderWidth: 1.5, padding: 16 },
});
