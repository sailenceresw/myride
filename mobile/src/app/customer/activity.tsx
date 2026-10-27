import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, RefreshControl, SectionList, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackHeader, Button, Card, Icon, Pill, Row, Txt, type IconName } from '@/components/ui';
import { api, rs, type Trip } from '@/lib/api';
import { call } from '@/lib/config';
import { useTheme, vehicleEmoji, type Theme } from '@/lib/theme';

type Past = Trip;
const STATUS: Record<string, [string, IconName, keyof Theme]> = {
  completed: ['Completed', 'checkmark-circle', 'ok'], cancelled: ['Cancelled', 'close-circle', 'danger'], no_driver: ['No rider found', 'alert-circle', 'muted'],
  searching: ['Finding a rider', 'search', 'accent'], accepted: ['Rider on the way', 'navigate', 'brand'], arrived: ['Rider arrived', 'flag', 'brand'],
  in_progress: ['On the way', 'navigate', 'brand'], scheduled: ['Scheduled', 'time', 'accent'],
};
const day = (ms: number) => {
  const d = new Date(ms), today = new Date();
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
};

/** The customer's trips: rides, parcels and logistics, newest first, grouped by day. */
export default function Activity() {
  const t = useTheme();
  const [trips, setTrips] = useState<Past[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [support, setSupport] = useState<string | null>(null);
  useEffect(() => { api<{ support?: { phone: string | null } }>('GET', '/api/config').then((c) => setSupport(c.support?.phone ?? null)).catch(() => {}); }, []);
  const load = useCallback(async () => { setTrips(await api<Past[]>('GET', '/api/trips').catch(() => [])); setRefreshing(false); }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const done = trips?.filter((x) => x.status === 'completed') ?? [];
  const sections = (trips ?? []).reduce<{ title: string; data: Past[] }[]>((acc, x) => { // newest first, so each day is contiguous
    const title = day(x.createdAt);
    if (acc.at(-1)?.title === title) acc.at(-1)!.data.push(x); else acc.push({ title, data: [x] });
    return acc;
  }, []);
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ paddingHorizontal: 16 }}><BackHeader title="Your trips" /></View>
      {!trips ? <ActivityIndicator color={t.brand} style={{ marginTop: 40 }} /> : (
        <SectionList
          sections={sections}
          keyExtractor={(x) => x.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
          contentContainerStyle={{ padding: 16, paddingTop: 4, gap: 2 }}
          ListHeaderComponent={trips.length ? (
            <Row style={{ gap: 10, marginBottom: 6 }}>
              <Stat icon="car-sport-outline" value={String(done.length)} label="trips" />
              <Stat icon="map-outline" value={`${done.reduce((a, x) => a + x.route.km, 0).toFixed(0)} km`} label="travelled" />
              <Stat icon="wallet-outline" value={rs(done.reduce((a, x) => a + x.fare, 0))} label="spent" />
            </Row>
          ) : undefined}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="receipt-outline" size={56} color={t.line} />
              <Txt kind="h2">No trips yet</Txt>
              <Txt kind="muted" style={{ textAlign: 'center' }}>Your rides, parcels and deliveries will show up here.</Txt>
            </View>
          }
          renderSectionHeader={({ section }) => <Txt kind="label" style={{ marginTop: 14, marginBottom: 4 }}>{section.title}</Txt>}
          renderItem={({ item }) => <TripRow trip={item} support={support} />}
        />
      )}
    </SafeAreaView>
  );
}

/** A past trip; tap to open the receipt with "Book again" and "Get help", like Uber's trip details. */
function TripRow({ trip, support }: { trip: Past; support: string | null }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [label, icon, color] = STATUS[trip.status] ?? [trip.status, 'ellipse', 'muted'];
  const d = trip.driver;
  return (
    <Card style={{ marginVertical: 4 }} onPress={() => setOpen(!open)}>
      <Row style={{ gap: 12 }}>
        <View style={[styles.badge, { backgroundColor: t.chip }]}><Text style={{ fontSize: 24 }}>{vehicleEmoji(trip.service)}</Text></View>
        <View style={{ flex: 1, gap: 2 }}>
          <Txt style={{ fontWeight: '800' }} numberOfLines={1}>{trip.drop.label ?? 'Drop'}</Txt>
          <Txt kind="small" numberOfLines={1}>From {trip.pickup.label ?? 'pickup'} · {trip.route.km.toFixed(1)} km</Txt>
          <Row style={{ gap: 6, marginTop: 2 }}>
            <Pill icon={icon} text={label} color={t[color]} tint={t.chip} />
            <Txt kind="small">{new Date(trip.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Txt>
          </Row>
        </View>
        <Txt kind="price" style={{ color: trip.fare === 0 ? t.ok : t.ink }}>{trip.fare === 0 ? 'FREE' : rs(trip.fare)}</Txt>
      </Row>
      {open && (
        <View style={{ marginTop: 12, gap: 8 }}>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line }} />
          <Row style={{ gap: 10, alignItems: 'flex-start' }}>
            <View style={{ alignItems: 'center', gap: 3, paddingTop: 5 }}>
              <View style={[styles.dot, { backgroundColor: t.ink }]} /><View style={{ width: 2, height: 22, backgroundColor: t.line }} /><View style={[styles.dot, { backgroundColor: t.ink, borderRadius: 2 }]} />
            </View>
            <View style={{ flex: 1, gap: 10 }}>
              <Txt numberOfLines={1}>{trip.pickup.label ?? 'Pickup'}</Txt>
              {trip.stops?.map((s, i) => <Txt key={i} kind="small" numberOfLines={1}>Stop {i + 1}: {s.label}</Txt>)}
              <Txt numberOfLines={1} style={{ fontWeight: '700' }}>{trip.drop.label ?? 'Drop'}</Txt>
            </View>
          </Row>
          <Txt kind="small">{new Date(trip.createdAt).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} · {trip.route.km.toFixed(1)} km{d ? ` · ${d.name} · ${d.vehicle.plate}` : ''}</Txt>
          {trip.status === 'completed' && trip.quote?.lines?.map((l, i) => (
            <Row key={i} style={{ justifyContent: 'space-between' }}><Txt kind="muted">{l.label}</Txt><Txt kind="muted">{l.amount < 0 ? '−' : ''}{rs(Math.abs(l.amount))}</Txt></Row>
          ))}
          <Row style={{ justifyContent: 'space-between' }}>
            <Txt style={{ fontWeight: '800', textTransform: 'capitalize' }}>Paid · {trip.payment.method}</Txt>
            {trip.riderRating && <Row style={{ gap: 2 }}>{Array.from({ length: trip.riderRating.stars }, (_, i) => <Icon key={i} name="star" size={14} color={t.accent} />)}</Row>}
          </Row>
          <Row style={{ gap: 8 }}>
            <Button title="Book again" icon="refresh" kind="dark" onPress={() => router.navigate({ pathname: '/customer', params: { rebook: trip.id } })} style={{ flex: 1 }} />
            {support && <Button title="Get help" icon="help-buoy-outline" kind="soft" onPress={() => call(support)} style={{ flex: 1 }} />}
          </Row>
        </View>
      )}
    </Card>
  );
}

function Stat({ icon, value, label }: { icon: IconName; value: string; label: string }) {
  const t = useTheme();
  return (
    <View style={[styles.stat, { backgroundColor: t.card, borderColor: t.line }]}>
      <Icon name={icon} size={18} color={t.brand} />
      <Text style={{ color: t.ink, fontWeight: '900', fontSize: 16, marginTop: 4 }} numberOfLines={1}>{value}</Text>
      <Txt kind="small">{label}</Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  stat: { flex: 1, borderRadius: 16, borderWidth: 1, padding: 12 },
  empty: { alignItems: 'center', gap: 8, marginTop: 60, paddingHorizontal: 30 },
  dot: { width: 9, height: 9, borderRadius: 5 },
});
