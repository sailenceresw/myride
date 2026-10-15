import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackHeader, Card, Chip, Icon, Row, Txt } from '@/components/ui';
import { api, rs } from '@/lib/api';
import { useTheme, vehicleEmoji } from '@/lib/theme';

type Sample = { km: number; fare: number; gandakiMax: number; competitors: { name: string; estimate: number }[] };
type FareRow = { id: string; label: string; base: number; perKm: number; minFare: number; samples: Sample[] };

/** Public fare chart: MyRide vs the Gandaki legal maximum and competitor estimates. No surge, ever. */
export default function Fares() {
  const t = useTheme();
  const [rows, setRows] = useState<FareRow[]>([]);
  const [sel, setSel] = useState('bike');
  useEffect(() => { api<{ rows: FareRow[] }>('GET', '/api/fares').then((r) => setRows(r.rows)).catch(() => {}); }, []);
  const row = rows.find((r) => r.id === sel);
  const names = row?.samples[0]?.competitors.map((c) => c.name).slice(0, 2) ?? [];
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }}>
        <BackHeader title="Fare chart" />
        <Row style={{ flexWrap: 'wrap' }}>{rows.map((r) => <Chip key={r.id} label={`${vehicleEmoji(r.id)} ${r.label.replace('MyRide ', '')}`} active={sel === r.id} onPress={() => setSel(r.id)} />)}</Row>
        {row && (
          <Card>
            <Txt kind="h2">{rs(row.base)} start + {rs(row.perKm, 1)}/km</Txt>
            <Txt kind="small">Minimum fare {rs(row.minFare)} · fixed price before you book</Txt>
            <View style={[styles.tr, { borderColor: t.line }]}>
              {['km', 'MyRide', 'Legal max', ...names].map((h) => <Text key={h} style={[styles.th, { color: t.muted }]}>{h}</Text>)}
            </View>
            {row.samples.map((s) => (
              <View key={s.km} style={[styles.tr, { borderColor: t.line }]}>
                <Text style={[styles.td, { color: t.muted }]}>{s.km}</Text>
                <Text style={[styles.td, { color: t.ok, fontWeight: '800' }]}>{rs(s.fare)}</Text>
                <Text style={[styles.td, { color: t.ink }]}>{rs(s.gandakiMax)}</Text>
                {s.competitors.slice(0, 2).map((c) => <Text key={c.name} style={[styles.td, { color: t.ink }]}>{rs(c.estimate)}</Text>)}
              </View>
            ))}
          </Card>
        )}
        <Row><Icon name="shield-checkmark" size={16} color={t.ok} /><Txt kind="small" style={{ flex: 1 }}>Fares stay under the Gandaki Province maximum and the national draft cap. No surge pricing.</Txt></Row>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  tr: { flexDirection: 'row', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  th: { flex: 1, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', textAlign: 'right' },
  td: { flex: 1, fontSize: 14, textAlign: 'right' },
});
