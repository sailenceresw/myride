import { useEffect, useState } from 'react';
import { Alert, ScrollView, Share, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackHeader, Button, Card, Pill, Row, Txt } from '@/components/ui';
import { api, apiUrlFor, rs } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

type Plans = Record<'plus_monthly' | 'plus_yearly', { label: string; price: number }>;

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
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 6 }}>
        <BackHeader title={profile.name} kind="h1" />
        <Txt kind="muted">+977 {profile.phone}</Txt>

        <Card style={{ borderColor: m.active ? t.accent : t.line, borderWidth: 2 }}>
          <Row style={{ justifyContent: 'space-between' }}><Txt kind="h2">{m.active ? '⭐ MyRide Plus' : 'MyRide Plus'}</Txt>{m.active && <Pill text="ACTIVE" color={t.accent} />}</Row>
          <Txt kind="muted">5% off every ride, parcel & logistics job (max Rs 25) · 3 free cancellations a month · priority matching · no COD fee</Txt>
          {m.active ? (
            <Txt kind="small" style={{ marginTop: 6 }}>{m.label} · until {m.expiresAt ? new Date(m.expiresAt).toLocaleDateString() : ''}</Txt>
          ) : plans && (
            <>
              <Button title={`${rs(plans.plus_monthly.price, 2)} / month`} onPress={() => subscribe('plus_monthly')} loading={busy === 'plus_monthly'} style={{ marginTop: 10 }} />
              <Button title={`${rs(plans.plus_yearly.price, 2)} / year — save 17%`} kind="accent" onPress={() => subscribe('plus_yearly')} loading={busy === 'plus_yearly'} style={{ marginTop: 8 }} />
              <Button title="Try free for 7 days" kind="ghost" onPress={trial} loading={busy === 'trial'} style={{ marginTop: 8 }} />
            </>
          )}
        </Card>

        <Card><Row style={{ justifyContent: 'space-between' }}><Txt kind="h2">Credits</Txt><Txt kind="price">{rs(profile.credits)}</Txt></Row><Txt kind="small">Applied automatically when you book.</Txt></Card>

        <Card>
          <Txt kind="h2">Invite friends, ride free</Txt>
          <Txt kind="muted">They get their first ride free (up to Rs 100). You get Rs 50 when they finish it.</Txt>
          <Text style={{ fontSize: 26, fontWeight: '900', letterSpacing: 4, color: t.brand, textAlign: 'center', marginVertical: 8 }}>{profile.referral.code}</Text>
          <Button title="Share invite" kind="ghost" onPress={invite} />
          <Txt kind="small" style={{ marginTop: 4 }}>Earned {rs(profile.referral.earned)}</Txt>
        </Card>

        <Card><Txt kind="h2">Drive with MyRide</Txt><Txt kind="muted">Get the MyRide Drive app — same mobile number, separate driver account. Weekly payouts to your bank.</Txt></Card>

        <Button title="Sign out" kind="ghost" onPress={signOut} style={{ marginTop: 8 }} />
      </ScrollView>
    </SafeAreaView>
  );
}
