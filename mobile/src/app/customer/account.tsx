import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { PayScreen, type PayInit } from '@/components/PayScreen';
import { Avatar, BackHeader, Button, Card, Hero, Icon, ListRow, Pill, Row, Txt } from '@/components/ui';
import { api, apiUrlFor, rs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { call } from '@/lib/config';
import { shadow, useTheme } from '@/lib/theme';
import { useSavedPlaces, type SavedKey } from '@/lib/useSavedPlaces';

type Plans = Record<'plus_monthly' | 'plus_yearly', { label: string; price: number }>;
type Config = { membership: { plans: Plans }; safety: { police: string; ambulance: string; touristPolice: string; fire: string }; support?: { phone: string | null } };
// On screen, "rider" is the person driving (see mobile/AGENTS.md).
const RIDER_STATUS: Record<string, string> = {
  none: 'Earn with your motorcycle, car or van. Weekly payouts to your bank.', draft: 'Continue your application',
  submitted: 'Application under review (usually within 48 hours)', resubmit: 'MyRide asked you to update your application',
  rejected: 'Your application was not approved', approved: 'Sign in to the MyRide Drive app with this number to earn',
};
const PERKS = ['5% off every trip (up to Rs 25)', '3 free cancellations a month', 'Priority matching at busy times', 'No cash-on-delivery fee'];
const SAVED: Record<SavedKey, [string, 'home' | 'briefcase']> = { home: ['Home', 'home'], work: ['Work', 'briefcase'] };

/** Account, ordered like Uber's: you, your places and trips, wallet and offers, safety and help, then sign out. */
export default function Account() {
  const t = useTheme();
  const { profile, refresh, signOut } = useAuth();
  const { places } = useSavedPlaces();
  const [config, setConfig] = useState<Config | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [checkout, setCheckout] = useState<{ plan: 'plus_monthly' | 'plus_yearly'; method: 'esewa' | 'khalti' | 'sandbox' } | null>(null);
  const [name, setName] = useState('');

  useEffect(() => { api<Config>('GET', '/api/config').then(setConfig).catch(() => {}); }, []);

  if (!profile) return null;
  const m = profile.membership;
  const plans = config?.membership.plans;

  // Plus is paid in eSewa or Khalti's own page (PayScreen); "Test payment" exists only in development builds.
  function subscribe(plan: 'plus_monthly' | 'plus_yearly') {
    const pay = (method: 'esewa' | 'khalti' | 'sandbox') => setCheckout({ plan, method });
    Alert.alert('Pay for MyRide Plus', 'Choose how to pay', [
      { text: 'eSewa', onPress: () => pay('esewa') },
      { text: 'Khalti', onPress: () => pay('khalti') },
      ...(__DEV__ ? [{ text: 'Test payment (dev)', onPress: () => pay('sandbox') }] : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  }
  async function trial() {
    setBusy('trial');
    try { await api('POST', '/api/membership/trial', { plan: 'plus_monthly' }); await refresh(); } catch (e) { Alert.alert('Trial', (e as Error).message); }
    setBusy(null);
  }
  async function saveName() {
    const n = name.trim();
    if (n.length < 2) return Alert.alert('Name', 'Enter your name as riders should see it.');
    setBusy('name');
    try { await api('PATCH', '/api/profile', { name: n }); await refresh(); setEditing(false); } catch (e) { Alert.alert('Name', (e as Error).message); }
    setBusy(null);
  }
  // Store rule: delete your account from inside the app. Two steps, because it cannot be undone.
  const deleteAccount = () => Alert.alert(
    'Delete your account?',
    'Your name, number, saved contacts and chats are removed and you are signed out everywhere. Unused credits are lost. Trip records are kept for accounting, without your details. This cannot be undone.',
    [
      { text: 'Keep my account', style: 'cancel' },
      {
        text: 'Delete account', style: 'destructive',
        onPress: async () => {
          try { await api('DELETE', '/api/profile'); Alert.alert('Account deleted', 'Thank you for riding with MyRide.'); await signOut(); } catch (e) { Alert.alert('Delete account', (e as Error).message); }
        },
      },
    ],
  );
  const invite = () => Share.share({ message: `Ride free on MyRide in Pokhara! Use my code ${profile.referral.code} — your first ride is free (up to Rs 100). ${apiUrlFor(`/?ref=${profile.referral.code}`)}` });
  const setPlace = (k: SavedKey) => router.navigate({ pathname: '/customer', params: { set: k } });
  const s = config?.safety;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
        <Hero style={{ paddingBottom: 48 }}>
          <BackHeader title="Account" light />
          <Row style={{ gap: 14, marginTop: 10 }}>
            <View style={styles.ring}><Avatar name={profile.name} size={60} /></View>
            <View style={{ flex: 1 }}>
              {editing ? (
                <TextInput autoFocus value={name} onChangeText={setName} maxLength={60} onSubmitEditing={saveName} returnKeyType="done" style={styles.nameInput} placeholderTextColor="#ffffffa0" placeholder="Your name" />
              ) : (
                <Text style={styles.name} numberOfLines={2}>{profile.name}</Text>
              )}
              <Text style={styles.phone}>+977 {profile.phone}{m.active ? '  ·  ★ PLUS' : ''}</Text>
            </View>
            {editing
              ? <Pressable onPress={saveName} style={styles.editBtn} accessibilityLabel="Save name"><Text style={styles.editText}>{busy === 'name' ? '…' : 'Save'}</Text></Pressable>
              : <Pressable onPress={() => { setName(profile.name); setEditing(true); }} style={styles.editBtn} accessibilityLabel="Edit name"><Icon name="pencil" size={16} color="#fff" /></Pressable>}
          </Row>
        </Hero>

        <View style={{ paddingHorizontal: 16, marginTop: -30, gap: 6 }}>
          <Card raised>
            {(Object.keys(SAVED) as SavedKey[]).map((k) => (
              <ListRow key={k} icon={SAVED[k][1]} title={SAVED[k][0]} subtitle={places[k]?.label && places[k]?.label !== SAVED[k][0] ? places[k]!.label : places[k] ? 'Saved' : `Add your ${SAVED[k][0].toLowerCase()} address`} onPress={() => setPlace(k)} />
            ))}
            <ListRow icon="receipt-outline" title="Your trips" subtitle="Receipts, book again, get help" onPress={() => router.push('/customer/activity')} />
          </Card>

          <Card>
            <ListRow icon="wallet" title="MyRide credits" subtitle="Applied automatically when you book" right={<Txt kind="price">{rs(profile.credits)}</Txt>} />
            <ListRow icon="gift" title="Invite friends, ride free" subtitle={`They ride free (up to Rs 100). You get Rs 50. Earned ${rs(profile.referral.earned)}`} onPress={invite} />
            <View style={[styles.code, { borderColor: t.brand, backgroundColor: t.brandSoft }]}>
              <Text style={{ fontSize: 22, fontWeight: '900', letterSpacing: 5, color: t.brand }}>{profile.referral.code}</Text>
            </View>
            <Button title="Share invite" icon="share-social" kind="soft" onPress={invite} />
          </Card>

          {m.active ? (
            <Card><ListRow icon="star" title="MyRide Plus" subtitle={`${m.label} · renews ${m.expiresAt ? new Date(m.expiresAt).toLocaleDateString() : ''}`} right={<Pill text="ACTIVE" color={t.ok} tint={t.okSoft} />} /></Card>
          ) : (
            <Card raised style={[{ borderColor: t.accent, borderWidth: 1.5 }, shadow(8)]}>
              <Row><Icon name="star" size={20} color={t.accent} /><Txt kind="h2">MyRide Plus</Txt></Row>
              <View style={{ gap: 6, marginVertical: 10 }}>
                {PERKS.map((p) => <Row key={p}><Icon name="checkmark-circle" size={18} color={t.ok} /><Txt kind="muted">{p}</Txt></Row>)}
              </View>
              {plans && (
                <View style={{ gap: 8 }}>
                  <Row>
                    <PlanButton title="Monthly" price={rs(plans.plus_monthly.price, 2)} onPress={() => subscribe('plus_monthly')} busy={busy === 'plus_monthly'} />
                    <PlanButton title="Yearly" price={rs(plans.plus_yearly.price, 2)} badge="Save 17%" onPress={() => subscribe('plus_yearly')} busy={busy === 'plus_yearly'} best />
                  </Row>
                  <Button title="Try free for 7 days" kind="ghost" onPress={trial} loading={busy === 'trial'} />
                </View>
              )}
            </Card>
          )}

          <Txt kind="label" style={styles.section}>Safety</Txt>
          <Card>
            <Txt kind="small" style={{ marginBottom: 4 }}>During a trip, SOS calls the police and alerts MyRide. Share your trip so family can follow it live.</Txt>
            {s && <>
              <ListRow icon="shield-checkmark" title="Police" subtitle={s.police} onPress={() => call(s.police)} />
              <ListRow icon="medkit" title="Ambulance" subtitle={s.ambulance} onPress={() => call(s.ambulance)} />
              <ListRow icon="people" title="Tourist police" subtitle={s.touristPolice} onPress={() => call(s.touristPolice)} />
            </>}
          </Card>

          <Txt kind="label" style={styles.section}>More</Txt>
          <Card>
            {config?.support?.phone && <ListRow icon="help-buoy-outline" title="Help and support" subtitle={`Call MyRide on ${config.support.phone}`} onPress={() => call(config.support!.phone!)} />}
            <ListRow icon="pricetags-outline" title="Fare chart" subtitle="MyRide fares vs the legal maximum, Pathao and Yango" onPress={() => router.push('/customer/fares')} />
            <ListRow icon="car-sport" title={profile.isDriver ? "You're a MyRide rider" : 'Become a MyRide rider'} subtitle={RIDER_STATUS[profile.isDriver ? 'approved' : profile.driverApplication?.status ?? 'none']} onPress={() => router.push(profile.driverApplication || profile.isDriver ? '/customer/apply' : '/become-rider')} />
          </Card>

          <Card>
            <ListRow icon="document-lock-outline" title="Privacy policy" subtitle="What we collect and who can see it" onPress={() => WebBrowser.openBrowserAsync(apiUrlFor('/privacy.html'))} />
            <ListRow icon="trash-outline" title="Delete account" subtitle="Remove your personal data from MyRide" onPress={deleteAccount} right={<Icon name="chevron-forward" size={18} color={t.danger} />} />
          </Card>

          <Button title="Sign out" icon="log-out-outline" kind="ghost" onPress={() => Alert.alert('Sign out?', 'You will need an SMS code to sign in again.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Sign out', style: 'destructive', onPress: signOut }])} style={{ marginTop: 8 }} />
        </View>
      </ScrollView>

      {checkout && (
        <PayScreen
          visible title="MyRide Plus" onClose={() => setCheckout(null)}
          start={() => api<PayInit>('POST', '/api/membership/checkout', { plan: checkout.plan, payment: checkout.method })}
          onResult={async (r) => {
            if (r === 'membership_active') { await refresh(); Alert.alert('Welcome to MyRide Plus', '5% off every trip, free cancellations and priority matching.'); }
            else if (r !== 'cancelled') Alert.alert('Payment', 'The payment did not go through. You have not been charged for Plus.');
          }}
        />
      )}
    </View>
  );
}

function PlanButton({ title, price, badge, onPress, busy, best }: { title: string; price: string; badge?: string; onPress: () => void; busy: boolean; best?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Card onPress={busy ? undefined : onPress} selected={best} style={{ alignItems: 'center', paddingVertical: 16 }}>
        {badge && <View style={[styles.badge, { backgroundColor: t.accent }]}><Text style={{ fontSize: 10, fontWeight: '900', color: '#1d1405' }}>{badge}</Text></View>}
        <Txt kind="label">{title}</Txt>
        <Txt kind="price" style={{ marginTop: 4 }}>{busy ? '…' : price}</Txt>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { padding: 3, borderRadius: 40, backgroundColor: '#ffffff33' },
  name: { color: '#fff', fontSize: 22, fontWeight: '900' },
  nameInput: { color: '#fff', fontSize: 20, fontWeight: '800', borderBottomWidth: 1.5, borderColor: '#ffffffa0', paddingVertical: 4 },
  phone: { color: '#ffffffc0', fontSize: 14, marginTop: 2 },
  editBtn: { minWidth: 40, height: 40, borderRadius: 20, paddingHorizontal: 12, backgroundColor: '#ffffff22', alignItems: 'center', justifyContent: 'center' },
  editText: { color: '#fff', fontWeight: '800' },
  code: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 14, alignItems: 'center', paddingVertical: 10, marginVertical: 10 },
  badge: { position: 'absolute', top: -9, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
  section: { marginTop: 12, marginBottom: 2 },
});
