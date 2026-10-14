import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Card, Row, Txt } from '@/components/ui';
import { api, rs } from '@/lib/api';
import { useTheme } from '@/lib/theme';

type Line = { label: string; amount: number };
type Dash = {
  driver: { driverType: string; wallet: number; cashHeld?: number; earnings: { today: number; trips: number }; bank?: { bank: string; accountNumber: string } };
  thisWeek: { lines: Line[]; net: number; balance?: number; weekNet?: number; warnings?: string[] };
  payouts: { week: { start: string; end: string }; amount: number; status: string }[];
};

export default function Earnings() {
  const t = useTheme();
  const [d, setD] = useState<Dash | null>(null);
  useEffect(() => { api<Dash>('GET', '/api/driver/dashboard').then(setD).catch(() => {}); }, []);
  if (!d?.driver) return null;
  const emp = d.driver.driverType === 'employee';
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 6 }}>
        <Row><Pressable onPress={() => router.back()} accessibilityLabel="Back"><Text style={{ fontSize: 24, color: t.ink }}>←</Text></Pressable><Txt kind="h1">Earnings</Txt></Row>
        <Card>
          <Txt kind="muted">{emp ? 'Wages this week (paid Sunday)' : d.driver.wallet < 0 ? 'You owe MyRide (cash trips)' : 'Next payout (Sunday)'}</Txt>
          <Text style={{ fontSize: 34, fontWeight: '900', color: d.driver.wallet < 0 && !emp ? t.danger : t.ok }}>{rs(emp ? d.thisWeek.net : Math.abs(d.driver.wallet))}</Text>
          <Txt kind="small">To {d.driver.bank?.bank ?? 'your bank'} ••••{String(d.driver.bank?.accountNumber ?? '').slice(-4)}</Txt>
          {emp && !!d.driver.cashHeld && <Txt kind="small">Cash fares to deposit at the hub: {rs(d.driver.cashHeld)}</Txt>}
        </Card>
        <Card>
          <Txt kind="h2">This week</Txt>
          {d.thisWeek.lines.map((l, i) => <Row key={i} style={{ justifyContent: 'space-between', marginTop: 4 }}><Txt kind="muted">{l.label}</Txt><Txt>{rs(l.amount)}</Txt></Row>)}
          {(d.thisWeek.warnings ?? []).map((w, i) => <Txt key={i} kind="small" style={{ color: t.danger, marginTop: 4 }}>{w}</Txt>)}
        </Card>
        <Txt kind="h2" style={{ marginTop: 8 }}>Payouts</Txt>
        {d.payouts.length ? d.payouts.map((p, i) => (
          <Card key={i}><Row style={{ justifyContent: 'space-between' }}><Txt>{p.week.start} → {p.week.end}</Txt><Txt kind="price">{rs(p.amount)}</Txt></Row><Txt kind="small">{p.status.replace(/_/g, ' ')}</Txt></Card>
        )) : <Txt kind="muted">No payouts yet.</Txt>}
      </ScrollView>
    </SafeAreaView>
  );
}
