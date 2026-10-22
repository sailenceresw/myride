import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackHeader, Button, Card, Hero, Icon, ListRow, Pill, Row, Txt } from '@/components/ui';
import { api, rs } from '@/lib/api';
import { shadow, useTheme } from '@/lib/theme';

type Line = { label: string; amount: number };
type Dash = {
  driver: { driverType: string; wallet: number; cashHeld?: number; earnings: { today: number; trips: number }; bank?: { bank: string; accountNumber: string } };
  thisWeek: { lines: Line[]; net: number; balance?: number; weekNet?: number; warnings?: string[] };
  payouts: { week: { start: string; end: string }; amount: number; status: string }[];
};

export default function Earnings() {
  const t = useTheme();
  const [d, setD] = useState<Dash | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => api<Dash>('GET', '/api/driver/dashboard').then((r) => { setD(r); setFailed(false); }).catch(() => setFailed(true)), []);
  useEffect(() => { load(); }, [load]);
  if (!d?.driver) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg, paddingHorizontal: 16 }}>
        <BackHeader title="Earnings" />
        <View style={styles.center}>
          {failed ? <>
            <Icon name="cloud-offline-outline" size={56} color={t.muted} />
            <Txt kind="h2">{"Can't load your earnings"}</Txt>
            <Button title="Try again" icon="refresh" kind="soft" onPress={load} style={{ alignSelf: 'stretch' }} />
          </> : <ActivityIndicator color={t.brand} size="large" />}
        </View>
      </SafeAreaView>
    );
  }
  const emp = d.driver.driverType === 'employee';
  const owes = d.driver.wallet < 0 && !emp;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <Hero style={{ paddingBottom: 44 }}>
          <BackHeader title="Earnings" light />
          <Text style={styles.caption}>{emp ? 'Wages this week · paid Sunday' : owes ? 'You owe MyRide (cash trips)' : 'Next payout · Sunday'}</Text>
          <Text style={[styles.big, owes && { color: '#ffb4ae' }]}>{rs(emp ? d.thisWeek.net : Math.abs(d.driver.wallet))}</Text>
          <Row><Icon name="business-outline" size={15} color="#ffffffc0" /><Text style={styles.caption}>{d.driver.bank?.bank ?? 'Your bank'} ••••{String(d.driver.bank?.accountNumber ?? '').slice(-4)}</Text></Row>
        </Hero>

        <View style={{ paddingHorizontal: 16, marginTop: -26, gap: 6 }}>
          <Row style={{ gap: 10 }}>
            <Stat icon="cash-outline" label="Today" value={rs(d.driver.earnings.today)} />
            <Stat icon="car-outline" label="Trips today" value={String(d.driver.earnings.trips)} />
          </Row>
          {emp && !!d.driver.cashHeld && <Card><ListRow icon="file-tray-full-outline" title="Cash to deposit at the hub" right={<Txt kind="price">{rs(d.driver.cashHeld)}</Txt>} /></Card>}

          <Card>
            <Txt kind="h2" style={{ marginBottom: 6 }}>This week</Txt>
            {d.thisWeek.lines.map((l, i) => (
              <Row key={i} style={{ justifyContent: 'space-between', paddingVertical: 6 }}>
                <Txt kind="muted">{l.label}</Txt><Txt style={{ fontWeight: '700', color: l.amount < 0 ? t.danger : t.ink }}>{rs(l.amount)}</Txt>
              </Row>
            ))}
            {(d.thisWeek.warnings ?? []).map((w, i) => <Row key={i} style={{ marginTop: 6 }}><Icon name="warning" size={16} color={t.danger} /><Txt kind="small" style={{ color: t.danger, flex: 1 }}>{w}</Txt></Row>)}
          </Card>

          <Txt kind="label" style={{ marginTop: 12, marginBottom: 2 }}>Payout history</Txt>
          {d.payouts.length ? d.payouts.map((p, i) => (
            <Card key={i}>
              <Row style={{ justifyContent: 'space-between' }}>
                <View><Txt style={{ fontWeight: '700' }}>{p.week.start} → {p.week.end}</Txt><View style={{ marginTop: 4 }}><Pill text={p.status.replace(/_/g, ' ')} color={t.ok} tint={t.okSoft} /></View></View>
                <Txt kind="price">{rs(p.amount)}</Txt>
              </Row>
            </Card>
          )) : <Card><ListRow icon="calendar-outline" title="No payouts yet" subtitle="Payouts go to your bank every Sunday" /></Card>}
        </View>
      </ScrollView>
    </View>
  );
}

function Stat({ icon, label, value }: { icon: 'cash-outline' | 'car-outline'; label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={[styles.stat, shadow(6), { backgroundColor: t.card }]}>
      <Icon name={icon} size={20} color={t.brand} />
      <Txt kind="price" style={{ marginTop: 6 }}>{value}</Txt>
      <Txt kind="small">{label}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
  caption: { color: '#ffffffc0', fontSize: 14 },
  big: { color: '#fff', fontSize: 40, fontWeight: '900', marginVertical: 4, letterSpacing: -0.5 },
  stat: { flex: 1, borderRadius: 18, padding: 14 },
});
