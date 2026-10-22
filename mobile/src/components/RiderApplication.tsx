import * as ImagePicker from 'expo-image-picker';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackHeader, Button, Card, Chip, goBack, Icon, ListRow, Pill, Row, Steps, Txt, type IconName } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { IS_DRIVE } from '@/lib/config';
import { RADIUS, useTheme } from '@/lib/theme';

type Doc = 'citizenshipFront' | 'citizenshipBack' | 'licence' | 'policeReport' | 'selfie' | 'bluebook' | 'insurance';
type Application = {
  id: string; status: 'draft' | 'submitted' | 'approved' | 'rejected' | 'resubmit'; review?: { reason?: string };
  driverType?: 'partner' | 'employee'; preferredVehicle?: string;
  personal?: Record<string, string>; licence?: { number?: string; categories?: string[]; expiry?: string };
  vehicle?: Record<string, string | number | boolean>; bank?: Record<string, string>;
  documents: Partial<Record<Doc, string>>; requiredDocuments: Doc[]; consent?: boolean;
};
type Form = Required<Pick<Application, 'personal' | 'licence' | 'vehicle' | 'bank'>> & { driverType: 'partner' | 'employee'; type: string; consent: boolean };

// Vehicle types a rider can apply with (server config VEHICLES), with the licence categories they need.
const VEHICLES: [string, string, string][] = [
  ['bike', 'Motorcycle / scooter', '🏍️'], ['car', 'Car (public plate)', '🚗'], ['van', 'Cargo van', '🚐'], ['jeep', '4×4 jeep', '🚙'],
  ['cargo', 'Mini-truck', '🚚'], ['pickup', 'Pickup', '🛻'], ['truck_light', 'Light truck', '🚚'], ['truck', 'Truck', '🚛'],
];
const GOODS = ['cargo', 'van', 'jeep', 'pickup', 'truck_light', 'truck'];
const LICENCE = ['A', 'K', 'B', 'F', 'G'];
const DOCS: Record<Doc, [string, IconName]> = {
  citizenshipFront: ['Citizenship — front', 'card-outline'], citizenshipBack: ['Citizenship — back', 'card-outline'],
  licence: ['Driving licence', 'id-card-outline'], policeReport: ['Police clearance report', 'document-text-outline'],
  selfie: ['Selfie — face clearly visible', 'happy-outline'], bluebook: ['Bluebook (vehicle registration)', 'book-outline'],
  insurance: ['Third-party insurance', 'shield-checkmark-outline'],
};
const STEPS = ['Ride', 'You', 'Licence', 'Vehicle', 'Bank', 'Photos', 'Review'];

/** Native "Become a MyRide rider" application, used by the customer app and by MyRide Drive. */
export function RiderApplication() {
  const t = useTheme();
  const [app, setApp] = useState<Application | null | undefined>(undefined);
  const [banks, setBanks] = useState<string[]>([]);
  const [form, setForm] = useState<Form | null>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    Promise.all([api<Application | null>('GET', '/api/driver/application'), api<{ kyc: { banks: string[] } }>('GET', '/api/config')])
      .then(([a, c]) => {
        setBanks(c.kyc.banks);
        setApp(a);
        setForm({
          driverType: a?.driverType ?? 'partner', type: a?.preferredVehicle ?? String(a?.vehicle?.type ?? 'bike'), consent: !!a?.consent,
          personal: a?.personal ?? {}, licence: { categories: [], ...a?.licence }, vehicle: a?.vehicle ?? { fuel: 'petrol' }, bank: a?.bank ?? {},
        });
      })
      .catch((e) => { setApp(null); Alert.alert('Rider application', (e as Error).message); });
  }, []);

  if (app === undefined || !form) return <SafeAreaView style={[styles.center, { backgroundColor: t.bg }]}><ActivityIndicator color={t.brand} size="large" /></SafeAreaView>;
  if (app && app.status !== 'draft' && app.status !== 'resubmit') return <Status app={app} />;

  const partner = form.driverType === 'partner';
  const set = <K extends 'personal' | 'licence' | 'vehicle' | 'bank'>(k: K, patch: Partial<Form[K]>) => setForm({ ...form, [k]: { ...form[k], ...patch } });
  const field = (k: 'personal' | 'vehicle' | 'bank', key: string, label: string, opts: Partial<FieldProps> = {}) =>
    <Field key={key} label={label} value={String(form[k][key] ?? '')} onChange={(v) => set(k, { [key]: v })} {...opts} />;

  // Save what this step collected (the server keeps the draft, so the rider can finish later).
  const body = () => ({
    driverType: form.driverType, preferredVehicle: partner ? undefined : form.type, personal: form.personal, licence: form.licence, bank: form.bank, consent: form.consent,
    vehicle: partner ? { ...form.vehicle, type: form.type, seats: form.type === 'car' ? +(form.vehicle.seats ?? 4) : undefined, publicPlate: form.type === 'car' ? form.vehicle.publicPlate !== false : undefined, goodsPermit: GOODS.includes(form.type) ? !!form.vehicle.goodsPermit : undefined } : undefined,
  });
  const save = async () => { const a = await api<Application>('PUT', '/api/driver/application', body()); setApp(a); return a; };
  const go = async (to: number) => {
    setBusy('next');
    try { await save(); setStep(to === 3 && !partner ? (step < 3 ? 4 : 2) : to); } catch (e) { Alert.alert('Could not save', (e as Error).message); }
    setBusy(null);
  };

  async function photo(kind: Doc) {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) return Alert.alert('Camera', 'Allow camera access to photograph your documents.');
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.35, base64: true, cameraType: kind === 'selfie' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back });
    if (r.canceled || !r.assets[0]?.base64) return;
    setBusy(kind);
    try {
      if (!app) await save();
      await api('POST', '/api/driver/application/documents', { kind, data: `data:image/jpeg;base64,${r.assets[0].base64}` });
      setApp(await api<Application>('GET', '/api/driver/application'));
    } catch (e) { Alert.alert('Upload failed', (e as Error).message); }
    setBusy(null);
  }

  async function submit() {
    setBusy('submit'); setErrors([]);
    try { await save(); setApp(await api<Application>('POST', '/api/driver/application/submit')); } catch (e) {
      setErrors(e instanceof ApiError && Array.isArray(e.data.errors) ? (e.data.errors as string[]) : [(e as Error).message]);
    }
    setBusy(null);
  }

  const required = app?.requiredDocuments ?? (Object.keys(DOCS) as Doc[]).filter((d) => partner || !['bluebook', 'insurance'].includes(d));
  const missing = required.filter((d) => !app?.documents?.[d]);
  const pages: ReactNode[] = [
    <>
      <Txt kind="h2">How will you ride with MyRide?</Txt>
      <Choice icon="key-outline" title="With my own vehicle" subtitle="Partner: you keep 88–90% of every fare, paid weekly" active={partner} onPress={() => setForm({ ...form, driverType: 'partner' })} />
      <Choice icon="briefcase-outline" title="Drive a MyRide fleet vehicle" subtitle="Salaried job with SSF, overtime and weekly wages" active={!partner} onPress={() => setForm({ ...form, driverType: 'employee' })} />
      <Txt kind="label" style={styles.label}>Vehicle</Txt>
      <Row style={{ flexWrap: 'wrap' }}>{VEHICLES.map(([id, label, emoji]) => <Chip key={id} label={`${emoji} ${label}`} active={form.type === id} onPress={() => setForm({ ...form, type: id })} />)}</Row>
    </>,
    <>
      <Txt kind="h2">About you</Txt>
      <Txt kind="muted">Exactly as on your citizenship certificate.</Txt>
      {field('personal', 'fullName', 'Full legal name', { autoComplete: 'name' })}
      {field('personal', 'dob', 'Date of birth (YYYY-MM-DD, AD)', { keyboardType: 'numbers-and-punctuation', placeholder: '1995-04-14' })}
      <Txt kind="label" style={styles.label}>Gender</Txt>
      <Row>{['male', 'female', 'other'].map((g) => <Chip key={g} label={g[0].toUpperCase() + g.slice(1)} active={form.personal.gender === g} onPress={() => set('personal', { gender: g })} />)}</Row>
      {field('personal', 'address', 'Permanent address', { placeholder: 'Pokhara-8, Srijana Chowk' })}
      {field('personal', 'citizenshipNo', 'Citizenship number', { placeholder: '45-01-70-12345' })}
      {field('personal', 'citizenshipDistrict', 'Issuing district', { placeholder: 'Kaski' })}
      {field('personal', 'nidNo', 'National ID number (optional)', { keyboardType: 'number-pad' })}
    </>,
    <>
      <Txt kind="h2">Driving licence</Txt>
      <Field label="Licence number" value={form.licence.number ?? ''} onChange={(number) => set('licence', { number })} placeholder="04-06-12345678" />
      <Txt kind="label" style={styles.label}>Categories on your licence</Txt>
      <Row>{LICENCE.map((c) => {
        const on = form.licence.categories?.includes(c);
        return <Chip key={c} label={c} active={on} onPress={() => set('licence', { categories: on ? form.licence.categories!.filter((x) => x !== c) : [...(form.licence.categories ?? []), c] })} />;
      })}</Row>
      <Txt kind="small">A = motorcycle · K = scooter · B = car, van, jeep · F/G = trucks</Txt>
      <Field label="Expiry date (YYYY-MM-DD)" value={form.licence.expiry ?? ''} onChange={(expiry) => set('licence', { expiry })} placeholder="2031-01-01" keyboardType="numbers-and-punctuation" />
    </>,
    <>
      <Txt kind="h2">Your vehicle</Txt>
      {field('vehicle', 'plate', 'Number plate', { placeholder: 'GA 1 PA 1234', autoCapitalize: 'characters' })}
      {field('vehicle', 'model', 'Make and model', { placeholder: 'Honda Shine 125' })}
      <Txt kind="label" style={styles.label}>Fuel</Txt>
      <Row>{['petrol', 'diesel', 'ev'].map((f) => <Chip key={f} label={f === 'ev' ? 'Electric' : f[0].toUpperCase() + f.slice(1)} active={form.vehicle.fuel === f} onPress={() => set('vehicle', { fuel: f })} />)}</Row>
      {field('vehicle', 'bluebookNo', 'Bluebook number')}
      {field('vehicle', 'insuranceExpiry', 'Insurance valid until (YYYY-MM-DD)', { keyboardType: 'numbers-and-punctuation', placeholder: '2027-08-01' })}
      {form.type === 'car' && <>
        {field('vehicle', 'seats', 'Seats (max 5)', { keyboardType: 'number-pad' })}
        <Toggle label="Public (black) number plate" value={form.vehicle.publicPlate !== false} onChange={(publicPlate) => set('vehicle', { publicPlate })} />
      </>}
      {GOODS.includes(form.type) && <Toggle label="Registered for goods transport (route permit)" value={!!form.vehicle.goodsPermit} onChange={(goodsPermit) => set('vehicle', { goodsPermit })} />}
    </>,
    <>
      <Txt kind="h2">Bank account for payouts</Txt>
      <Txt kind="muted">Earnings are paid every Sunday. The account must be in your own name.</Txt>
      {field('bank', 'bank', 'Bank', { placeholder: 'Start typing, e.g. Nabil' })}
      <Row style={{ flexWrap: 'wrap' }}>
        {banks.filter((b) => b !== form.bank.bank && b.toLowerCase().includes((form.bank.bank ?? '').toLowerCase())).slice(0, 6).map((b) => <Chip key={b} label={b} onPress={() => set('bank', { bank: b })} />)}
      </Row>
      {field('bank', 'branch', 'Branch', { placeholder: 'Lakeside' })}
      {field('bank', 'accountName', 'Account holder name')}
      {field('bank', 'accountNumber', 'Account number', { keyboardType: 'number-pad' })}
    </>,
    <>
      <Txt kind="h2">Photos of your documents</Txt>
      <Txt kind="muted">Use good light and keep all four corners in the frame.</Txt>
      <Card>
        {required.map((d) => (
          <ListRow key={d} icon={DOCS[d][1]} title={DOCS[d][0]} subtitle={app?.documents?.[d] ? 'Uploaded — tap to retake' : 'Not added yet'} onPress={() => photo(d)}
            right={busy === d ? <ActivityIndicator color={t.brand} /> : app?.documents?.[d] ? <Icon name="checkmark-circle" size={24} color={t.ok} /> : <Icon name="camera" size={22} color={t.brand} />} />
        ))}
      </Card>
    </>,
    <>
      <Txt kind="h2">Review and submit</Txt>
      <Card>
        <ListRow icon="car-sport-outline" title={partner ? 'Own vehicle (partner)' : 'MyRide fleet (salaried)'} subtitle={VEHICLES.find((v) => v[0] === form.type)?.[1]} onPress={() => setStep(0)} />
        <ListRow icon="person-outline" title={form.personal.fullName || 'Add your details'} subtitle={form.personal.citizenshipNo} onPress={() => setStep(1)} />
        <ListRow icon="id-card-outline" title={`Licence ${form.licence.number ?? ''}`} subtitle={form.licence.categories?.join(', ')} onPress={() => setStep(2)} />
        {partner && <ListRow icon="speedometer-outline" title={String(form.vehicle.plate || 'Add your vehicle')} subtitle={String(form.vehicle.model ?? '')} onPress={() => setStep(3)} />}
        <ListRow icon="business-outline" title={form.bank.bank || 'Add your bank'} subtitle={form.bank.accountNumber ? `••••${form.bank.accountNumber.slice(-4)}` : undefined} onPress={() => setStep(4)} />
        <ListRow icon="images-outline" title={missing.length ? `${missing.length} photo${missing.length > 1 ? 's' : ''} missing` : 'All photos added'} onPress={() => setStep(5)}
          right={<Icon name={missing.length ? 'alert-circle' : 'checkmark-circle'} size={22} color={missing.length ? t.accent : t.ok} />} />
      </Card>
      <Toggle label="I agree to a background check and to MyRide processing my documents for verification" value={form.consent} onChange={(consent) => setForm({ ...form, consent })} />
      {errors.map((e) => <Row key={e}><Icon name="alert-circle" size={16} color={t.danger} /><Text style={{ color: t.danger, flex: 1 }}>{e}</Text></Row>)}
    </>,
  ];

  const last = step === pages.length - 1;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 16 }}>
          <BackHeader title="Become a MyRide rider" />
          {app?.status === 'resubmit' && <Pill icon="information-circle" text={`Please update: ${app.review?.reason ?? 'see the SMS from MyRide'}`} color={t.accent} tint={t.accentSoft} />}
          <Steps steps={STEPS.filter((_, i) => partner || i !== 3)} at={partner || step < 3 ? step : step - 1} />
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }} keyboardShouldPersistTaps="handled">{pages[step]}</ScrollView>
        <Row style={[styles.footer, { borderColor: t.line, backgroundColor: t.card }]}>
          {step > 0 && <Button title="Back" kind="soft" onPress={() => go(step - 1)} style={{ flex: 1 }} />}
          {last
            ? <Button title="Submit application" icon="send" onPress={submit} loading={busy === 'submit'} disabled={!form.consent} style={{ flex: 2 }} />
            : <Button title="Continue" icon="arrow-forward" onPress={() => go(step + 1)} loading={busy === 'next'} style={{ flex: 2 }} />}
        </Row>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** After submitting: where the application stands and what happens next. */
function Status({ app }: { app: Application }) {
  const t = useTheme();
  const approved = app.status === 'approved';
  const [icon, title, text]: [IconName, string, string] = approved
    ? ['checkmark-circle', "You're a MyRide rider!", IS_DRIVE ? 'Go back and tap GO to start receiving trips.' : 'Install MyRide Drive and sign in with this same mobile number to start earning.']
    : app.status === 'rejected'
      ? ['close-circle', 'Application not approved', app.review?.reason ?? 'Contact MyRide support for details.']
      : ['time', 'Application submitted', "We review applications within 48 hours. We'll send you an SMS when you're approved."];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, padding: 16 }}>
      <BackHeader title="Rider application" />
      <View style={[styles.center, { gap: 12, paddingHorizontal: 12 }]}>
        <Icon name={icon} size={72} color={approved ? t.ok : app.status === 'rejected' ? t.danger : t.accent} />
        <Txt kind="h1" style={{ textAlign: 'center' }}>{title}</Txt>
        <Txt kind="muted" style={{ textAlign: 'center' }}>{text}</Txt>
        <Button title={IS_DRIVE ? 'Done' : 'Back to booking'} onPress={goBack} style={{ alignSelf: 'stretch', marginTop: 12 }} />
      </View>
    </SafeAreaView>
  );
}

type FieldProps = { label: string; value: string; onChange: (v: string) => void; placeholder?: string; keyboardType?: 'default' | 'number-pad' | 'numbers-and-punctuation'; autoCapitalize?: 'none' | 'words' | 'characters'; autoComplete?: 'name' };
function Field({ label, value, onChange, ...rest }: FieldProps) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Txt kind="label" style={styles.label}>{label}</Txt>
      <TextInput value={value} onChangeText={onChange} placeholderTextColor={t.muted} style={[styles.input, { borderColor: t.line, backgroundColor: t.card, color: t.ink }]} {...rest} />
    </View>
  );
}

const Toggle = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
  <Row style={{ paddingVertical: 8 }}><Switch value={value} onValueChange={onChange} /><Txt style={{ flex: 1 }}>{label}</Txt></Row>
);

function Choice({ icon, title, subtitle, active, onPress }: { icon: IconName; title: string; subtitle: string; active: boolean; onPress: () => void }) {
  return <Card selected={active} onPress={onPress}><ListRow icon={icon} title={title} subtitle={subtitle} right={active ? <Icon name="radio-button-on" size={22} /> : <Icon name="radio-button-off" size={22} />} /></Card>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: { marginTop: 6 },
  input: { borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  footer: { gap: 10, padding: 12, borderTopWidth: StyleSheet.hairlineWidth },
});
