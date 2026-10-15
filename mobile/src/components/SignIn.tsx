import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Icon, Pill, Row, Txt } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { PHONE_RE } from '@/lib/config';
import { shadow, useTheme } from '@/lib/theme';

/** Mobile-number + SMS-code sign-in card, shared by the customer sign-in and the "Become a rider" page. */
export function SignIn({ title = 'Enter your mobile number', referral = false, onDone }: { title?: string; referral?: boolean; onDone: () => void }) {
  const t = useTheme();
  const { requestOtp, verifyOtp } = useAuth();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
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
      await verifyOtp(phone, otp, name, code);
      onDone();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  const input = [styles.input, { borderColor: t.line, color: t.ink, backgroundColor: t.bg }];
  return (
    <View style={[styles.form, shadow(10), { backgroundColor: t.card }]}>
      {step === 'phone' ? (
        <>
          <Txt kind="h2">{title}</Txt>
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
          {referral && <TextInput value={code} onChangeText={(v) => setCode(v.toUpperCase())} placeholder="Friend's referral code (optional)" placeholderTextColor={t.muted} style={input} autoCapitalize="characters" maxLength={8} />}
          <Button title="Verify & continue" icon="checkmark" onPress={verify} loading={busy} disabled={otp.length !== 6} />
          <Row>
            <Button title={cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'} kind="ghost" disabled={cooldown > 0 || busy} onPress={send} style={{ flex: 1 }} />
            <Button title="Change number" kind="ghost" onPress={() => { setStep('phone'); setOtp(''); }} style={{ flex: 1 }} />
          </Row>
        </>
      )}
      {!!err && <Row><Icon name="alert-circle" size={18} color={t.danger} /><Text style={{ color: t.danger, fontSize: 14, flex: 1 }}>{err}</Text></Row>}
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
  form: { marginHorizontal: 16, marginTop: -32, borderRadius: 24, padding: 20, gap: 12 },
  phoneRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1.5, borderRadius: 14, paddingHorizontal: 14 },
  input: { borderWidth: 1, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16 },
  box: { width: 46, height: 56, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
