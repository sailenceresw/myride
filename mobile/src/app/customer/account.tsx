import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { Avatar, BackHeader, Button, Card, Hero, Icon, ListRow, Pill, Row, Txt } from '@/components/ui';
import { api, apiUrlFor, rs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { shadow, useTheme } from '@/lib/theme';

type Plans = Record<'plus_monthly' | 'plus_yearly', { label: string; price: number }>;
const RIDER_STATUS: Record<string, string> = {
  none: 'Earn with your motorcycle, car or van. Weekly payouts to your bank.', draft: 'Continue your application',
  submitted: 'Application under review (usually within 48 hours)', resubmit: 'MyRide asked you to update your application',
  rejected: 'Your application was not approved', approved: 'Sign in to the MyRide Drive app with this number to earn',
};
const PERKS = ['5% off every trip (up to Rs 25)', '3 free cancellations a month', 'Priority matching at busy times', 'No cash-on-delivery fee'];

export default function Account() {
  const t = useTheme();
  const { profile, refresh, signOut } = useAuth();
  const [plans, setPlans] = useState<Plans | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api<{ membership: { plans: Plans } }>('GET', '/api/config').then((c) => setPlans(c.membership.plans)).catch(() => {});
  }, []);

  if (!profile) return null;
  const m = profile.membership;

  async function subscribe(plan: 'plus_monthly' | 'plus_yearly') {
    setBusy(plan);
    try {
      // Sandbox checkout in development; production uses the eSewa/Khalti hosted payment page.
      await api('POST', '/api/membership/checkout', { plan, payment: 'sandbox' });
      await refresh();
      Alert.alert('Welcome to MyRide Plus', '5% off every trip, free cancellations and priority matching.');
    } catch (e) { Alert.alert('Payment', (e as Error).message); }
    setBusy(null);
  }
  async function trial() {
    setBusy('trial');
    try { await api('POST', '/api/membership/trial', { plan: 'plus_monthly' }); await refresh(); } catch (e) { Alert.alert('Trial', (e as Error).message); }
    setBusy(null);
  }
  const invite = () => Share.share({ message: `Ride free on MyRide in Pokhara! Use my code ${profile.referral.code} — your first ride is free (up to Rs 100). ${apiUrlFor(`/?ref=${profile.referral.code}`)}` });

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <Hero style={{ paddingBottom: 48 }}>
          <BackHeader title="Account" light />
          <Row style={{ gap: 14, marginTop: 10 }}>
            <View style={styles.ring}><Avatar name={profile.name} size={60} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{profile.name}</Text>
              <Text style={styles.phone}>+977 {profile.phone}</Text>
            </View>
            {m.active && <Pill icon="star" text="PLUS" color={t.accent} />}
          </Row>
        </Hero>

        <View style={{ paddingHorizontal: 16, marginTop: -30, gap: 6 }}>
          <Card raised style={[{ borderColor: t.accent, borderWidth: 1.5 }, shadow(8)]}>
            <Row style={{ justifyContent: 'space-between' }}>
              <Row><Icon name="star" size={20} color={t.accent} /><Txt kind="h2">MyRide Plus</Txt></Row>
              {m.active && <Pill text="ACTIVE" color={t.ok} tint={t.okSoft} />}
            </Row>
            <View style={{ gap: 6, marginVertical: 10 }}>
              {PERKS.map((p) => <Row key={p}><Icon name="checkmark-circle" size={18} color={t.ok} /><Txt kind="muted">{p}</Txt></Row>)}
            </View>
            {m.active ? (
              <Txt kind="small">{m.label} · renews {m.expiresAt ? new Date(m.expiresAt).toLocaleDateString() : ''}</Txt>
            ) : plans && (
              <View style={{ gap: 8 }}>
                <Row>
                  <PlanButton title="Monthly" price={rs(plans.plus_monthly.price, 2)} onPress={() => subscribe('plus_monthly')} busy={busy === 'plus_monthly'} />
                  <PlanButton title="Yearly" price={rs(plans.plus_yearly.price, 2)} badge="Save 17%" onPress={() => subscribe('plus_yearly')} busy={busy === 'plus_yearly'} best />
                </Row>
                <Button title="Try free for 7 days" kind="ghost" onPress={trial} loading={busy === 'trial'} />
              </View>
            )}
          </Card>

          <Card>
            <ListRow icon="wallet" title="MyRide credits" subtitle="Applied automatically when you book" right={<Txt kind="price">{rs(profile.credits)}</Txt>} />
          </Card>

          <Card>
            <ListRow icon="gift" title="Invite friends, ride free" subtitle={`They ride free (up to Rs 100). You get Rs 50. Earned ${rs(profile.referral.earned)}`} />
            <View style={[styles.code, { borderColor: t.brand, backgroundColor: t.brandSoft }]}>
              <Text style={{ fontSize: 24, fontWeight: '900', letterSpacing: 5, color: t.brand }}>{profile.referral.code}</Text>
            </View>
            <Button title="Share invite" icon="share-social" kind="soft" onPress={invite} />
          </Card>

          <Card>
            <ListRow icon="car-sport" title={profile.isDriver ? "You're a MyRide rider" : 'Become a MyRide rider'} subtitle={RIDER_STATUS[profile.isDriver ? 'approved' : profile.driverApplication?.status ?? 'none']} onPress={() => router.push('/customer/apply')} />
            <ListRow icon="pricetags-outline" title="Fare chart" subtitle="MyRide fares vs the legal maximum, Pathao and Yango" onPress={() => router.push('/customer/fares')} />
            <ListRow icon="shield-checkmark" title="Safety" subtitle="SOS calls Nepal Police (100) and alerts MyRide ops. Share your trip live." />
          </Card>

          <Button title="Sign out" icon="log-out-outline" kind="ghost" onPress={signOut} style={{ marginTop: 8 }} />
        </View>
      </ScrollView>
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
  phone: { color: '#ffffffc0', fontSize: 14, marginTop: 2 },
  code: { borderWidth: 1.5, borderStyle: 'dashed', borderRadius: 14, alignItems: 'center', paddingVertical: 12, marginVertical: 10 },
  badge: { position: 'absolute', top: -9, borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2 },
});
