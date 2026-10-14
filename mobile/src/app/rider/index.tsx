import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import type MapView from 'react-native-maps';
import { Marker, Polyline } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppMap, Button, Card, Pill, RoundButton, Row, Sheet, Txt } from '@/components/ui';
import { api, apiUrlFor, rs, type Point, type Quote, type Trip } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { call, POLICE } from '@/lib/config';
import { useTheme, vehicleEmoji } from '@/lib/theme';
import { useLocation } from '@/lib/useLocation';
import { usePolling } from '@/lib/usePolling';

type Kind = 'ride' | 'delivery' | 'logistics';
type Place = { id: string; name: string; lat: number; lng: number; category?: string };
type QuoteResp = { route: { km: number; min: number; geometry: [number, number][] }; quotes: Quote[]; pickupWard: string | null; dropWard: string | null; recommend: string | null; promoError: string | null };

const ACTIVE = ['scheduled', 'searching', 'accepted', 'arrived', 'in_progress'];
const KINDS: Record<Kind, string> = { ride: 'Ride', delivery: 'Parcel', logistics: 'Logistics' };
const PAYMENTS = { cash: '💵 Cash', esewa: 'eSewa', khalti: 'Khalti' } as const;
const PLACE_ICON: Record<string, string> = { ward: '🏘️', intercity: '🛣️', transport: '✈️' };
const STATUS: Record<string, string> = {
  searching: 'Finding your driver…', accepted: 'Driver is on the way', arrived: 'Your driver has arrived', in_progress: 'On the way',
  completed: 'You have arrived', cancelled: 'Trip cancelled', no_driver: 'No drivers available right now', scheduled: 'Scheduled',
};
const toLatLng = ({ lat, lng }: { lat: number; lng: number }) => ({ latitude: lat, longitude: lng });

export default function RiderHome() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { profile, refresh } = useAuth();
  const map = useRef<MapView>(null);
  const fix = useLocation('normal');

  const [kind, setKind] = useState<Kind>('ride');
  const [pickupChoice, setPickup] = useState<Point | null>(null);
  const [drop, setDrop] = useState<Point | null>(null);
  const [searching, setSearching] = useState<null | 'pickup' | 'drop'>(null);
  const [query, setQuery] = useState('');
  const [places, setPlaces] = useState<Place[]>([]);
  const [quote, setQuote] = useState<QuoteResp | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [payment, setPayment] = useState<keyof typeof PAYMENTS>('cash');
  const [weight, setWeight] = useState('2');
  const [receiver, setReceiver] = useState({ name: '', phone: '' });
  const [trip, setTrip] = useState<Trip | null>(null);
  const [nearby, setNearby] = useState<{ lat: number; lng: number; type: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Default pickup = the user's current location (until they pick another place).
  const here = useMemo(() => (fix ? { lat: fix.lat, lng: fix.lng, label: 'Current location' } : null), [fix]);
  const pickup = pickupChoice ?? here;

  // Start the map on the user's current location (first GPS fix).
  const centred = useRef(false);
  useEffect(() => {
    if (!fix || centred.current) return;
    centred.current = true;
    map.current?.animateCamera({ center: toLatLng(fix), zoom: 16, altitude: 1200 }, { duration: 700 });
  }, [fix]);

  // Places (landmarks, 33 wards, intercity lanes) and any trip still in progress.
  useEffect(() => {
    Promise.all([api<Place[]>('GET', '/api/places'), api<{ logistics: { destinations: Place[] } }>('GET', '/api/config')])
      .then(([p, c]) => setPlaces([...p, ...c.logistics.destinations.map((d) => ({ ...d, category: 'intercity' }))]))
      .catch(() => {});
    api<Trip[]>('GET', '/api/trips').then((l) => setTrip(l.find((x) => ACTIVE.includes(x.status)) ?? null)).catch(() => {});
  }, []);

  usePolling(async () => {
    const next = await api<Trip>('GET', `/api/trips/${trip!.id}`);
    if (next.status !== trip!.status) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setTrip(next);
  }, 3000, !!trip && ACTIVE.includes(trip.status));

  usePolling(async () => setNearby(await api('GET', `/api/nearby?lat=${pickup!.lat}&lng=${pickup!.lng}`)), 8000, !trip && !!pickup);

  const getQuote = useCallback(async (p: Point, d: Point, k: Kind) => {
    setErr(''); setBusy(true);
    try {
      const r = await api<QuoteResp>('POST', '/api/quote', { pickup: p, drop: d, kind: k, parcel: k === 'ride' ? undefined : { weightKg: +weight || 1 } });
      setQuote(r);
      setSel(r.recommend ?? r.quotes.find((q) => !q.unavailable)?.service ?? null);
      if (r.promoError) setErr(r.promoError);
      map.current?.fitToCoordinates(r.route.geometry.map(([lat, lng]) => toLatLng({ lat, lng })), { edgePadding: { top: 120, right: 50, bottom: 420, left: 50 }, animated: true });
    } catch (e) { setErr((e as Error).message); setQuote(null); }
    setBusy(false);
  }, [weight]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return places
      .filter((p) => (kind === 'logistics' || p.category !== 'intercity') && (q ? p.name.toLowerCase().includes(q) : p.category !== 'ward'))
      .slice(0, 40);
  }, [places, query, kind]);

  function choose(p: Point | null) { // null = back to current location
    const nextPickup = searching === 'pickup' ? p ?? here : pickup;
    const nextDrop = searching === 'drop' ? p : drop;
    if (searching === 'pickup') setPickup(p); else setDrop(p);
    setSearching(null);
    setQuery('');
    if (nextPickup && nextDrop) getQuote(nextPickup, nextDrop, kind);
  }
  function chooseKind(k: Kind) {
    setKind(k);
    if (pickup && drop) getQuote(pickup, drop, k);
  }

  async function book() {
    if (!pickup || !drop || !sel) return;
    setErr(''); setBusy(true);
    try {
      const goods = kind === 'ride' ? {} : { parcel: { weightKg: +weight || 1 }, recipient: receiver };
      setTrip(await api<Trip>('POST', '/api/trips', { service: sel, pickup, drop, payment, ...goods }));
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      setQuote(null);
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  }

  const tripAction = async (path: string, body: object) => {
    try { setTrip(await api<Trip>('POST', `/api/trips/${trip!.id}/${path}`, body)); } catch (e) { setErr((e as Error).message); }
  };
  const rate = async (stars: number) => { await api('POST', `/api/trips/${trip!.id}/rate`, { stars }).catch(() => {}); setTrip({ ...trip!, riderRating: { stars } }); };
  const sos = () => { api('POST', `/api/trips/${trip!.id}/sos`, { loc: fix }).catch(() => {}); call(POLICE); };
  const reset = () => { setTrip(null); setDrop(null); setQuote(null); refresh(); };

  const geometry = trip?.route.geometry ?? quote?.route.geometry;
  const routeCoords = useMemo(() => geometry?.map(([lat, lng]) => toLatLng({ lat, lng })), [geometry]);
  const selected = quote?.quotes.find((q) => q.service === sel);
  const pk = trip?.pickup ?? pickup, dp = trip?.drop ?? drop;
  const input = [styles.small, { borderColor: t.line, color: t.ink }];

  // ---------- search screen ----------
  if (searching) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ padding: 16, gap: 10 }}>
          <Row><Pressable onPress={() => setSearching(null)} accessibilityLabel="Back"><Text style={{ fontSize: 24, color: t.ink }}>←</Text></Pressable><Txt kind="h2">{searching === 'pickup' ? 'Pickup' : 'Where to?'}</Txt></Row>
          <TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Search landmark, ward (e.g. Ward 27) or city" placeholderTextColor={t.muted} style={[styles.search, { backgroundColor: t.card, color: t.ink, borderColor: t.line }]} />
          {searching === 'pickup' && here && <Card onPress={() => choose(null)}><Txt>📍 Use current location</Txt></Card>}
        </View>
        <FlatList
          data={results}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <Pressable onPress={() => choose({ lat: item.lat, lng: item.lng, label: item.name })} style={[styles.result, { borderColor: t.line }]}>
              <Text style={{ fontSize: 20 }}>{PLACE_ICON[item.category ?? ''] ?? '📍'}</Text>
              <View style={{ flex: 1 }}><Txt>{item.name}</Txt><Txt kind="small">{item.category === 'intercity' ? 'Intercity — logistics only' : item.category}</Txt></View>
            </Pressable>
          )}
        />
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <AppMap ref={map} showsUserLocation showsMyLocationButton={false} mapPadding={{ top: 0, bottom: 300, left: 0, right: 0 }}>
        {!trip && nearby.map((c, i) => (
          <Marker key={`n${i}`} coordinate={toLatLng(c)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}><Text style={{ fontSize: 22 }}>{vehicleEmoji(c.type)}</Text></Marker>
        ))}
        {routeCoords && <Polyline coordinates={routeCoords} strokeColor={t.ink} strokeWidth={5} />}
        {pk && <Marker coordinate={toLatLng(pk)} pinColor={t.brand} title="Pickup" />}
        {dp && <Marker coordinate={toLatLng(dp)} pinColor={t.accent} title="Drop" />}
        {trip?.driver?.loc && <Marker coordinate={toLatLng(trip.driver.loc)} anchor={{ x: 0.5, y: 0.5 }}><Text style={{ fontSize: 28 }}>{vehicleEmoji(trip.driver.vehicle.type)}</Text></Marker>}
      </AppMap>

      <View style={[styles.top, { top: insets.top + 8 }]}>
        <RoundButton icon="👤" label="Account" onPress={() => router.push('/rider/account')} />
        {profile?.membership.active && <Pill text="PLUS" color={t.accent} />}
        {profile?.firstRideFree && !trip && <View style={[styles.free, { backgroundColor: t.ok }]}><Text style={styles.freeText}>🎁 First ride free</Text></View>}
      </View>

      <Sheet>
        {trip ? (
          <TripPanel trip={trip} onCancel={() => tripAction('cancel', { reason: 'rider_cancelled' })} onRate={rate} onSos={sos} onDone={reset} />
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled">
            <Row style={{ marginBottom: 8 }}>
              {(Object.keys(KINDS) as Kind[]).map((k) => (
                <Pressable key={k} onPress={() => chooseKind(k)} style={[styles.tab, { backgroundColor: kind === k ? t.ink : t.bg }]}>
                  <Text style={{ color: kind === k ? t.bg : t.ink, fontWeight: '700' }}>{KINDS[k]}</Text>
                </Pressable>
              ))}
            </Row>
            <Pressable onPress={() => setSearching('pickup')} style={[styles.where, { backgroundColor: t.bg }]}>
              <View style={[styles.dot, { backgroundColor: t.brand }]} /><Txt numberOfLines={1} style={{ flex: 1 }}>{pickup?.label ?? 'Locating you…'}</Txt>
            </Pressable>
            <Pressable onPress={() => setSearching('drop')} style={[styles.where, { backgroundColor: t.bg }]}>
              <View style={[styles.dot, { backgroundColor: t.accent, borderRadius: 2 }]} /><Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: drop ? t.ink : t.muted }} numberOfLines={1}>{drop?.label ?? 'Where to?'}</Text>
            </Pressable>
            {!!quote && <Txt kind="small">{quote.route.km.toFixed(1)} km · {quote.pickupWard ?? ''}{quote.dropWard ? ` → ${quote.dropWard}` : ''}</Txt>}

            {kind !== 'ride' && drop && (
              <View style={{ gap: 6, marginTop: 6 }}>
                <Row>
                  <TextInput value={weight} onChangeText={setWeight} onEndEditing={() => pickup && getQuote(pickup, drop, kind)} keyboardType="decimal-pad" placeholder="kg" placeholderTextColor={t.muted} style={[...input, { width: 80 }]} />
                  <Txt kind="small">kg</Txt>
                  <TextInput value={receiver.name} onChangeText={(name) => setReceiver({ ...receiver, name })} placeholder="Receiver name" placeholderTextColor={t.muted} style={[...input, { flex: 1 }]} />
                </Row>
                <TextInput value={receiver.phone} onChangeText={(phone) => setReceiver({ ...receiver, phone: phone.replace(/\D/g, '').slice(0, 10) })} keyboardType="phone-pad" placeholder="Receiver mobile 98XXXXXXXX" placeholderTextColor={t.muted} style={input} />
              </View>
            )}

            {quote?.quotes.map((q) => <QuoteRow key={q.service} q={q} selected={q.service === sel} recommended={quote.recommend === q.service} onPress={() => !q.unavailable && setSel(q.service)} />)}

            {!!err && <Text style={{ color: t.danger, marginVertical: 6 }}>{err}</Text>}
            {selected && (
              <>
                <Row style={{ marginVertical: 8 }}>
                  {(Object.keys(PAYMENTS) as (keyof typeof PAYMENTS)[]).map((p) => (
                    <Pressable key={p} onPress={() => setPayment(p)} style={[styles.payChip, { borderColor: payment === p ? t.brand : t.line }]}>
                      <Text style={{ color: t.ink, fontWeight: payment === p ? '800' : '500' }}>{PAYMENTS[p]}</Text>
                    </Pressable>
                  ))}
                </Row>
                <Button title={`Choose ${selected.label}`} onPress={book} loading={busy} kind="dark" />
              </>
            )}
            {!drop && <Txt kind="small" style={{ marginTop: 8 }}>Fares are fixed and under the legal maximum — no surge pricing.</Txt>}
          </ScrollView>
        )}
      </Sheet>
    </View>
  );
}

function QuoteRow({ q, selected, recommended, onPress }: { q: Quote; selected: boolean; recommended: boolean; onPress: () => void }) {
  const t = useTheme();
  if (q.unavailable) return <Card style={{ opacity: 0.45 }}><Txt>{vehicleEmoji(q.service)} {q.label}</Txt><Txt kind="small">{q.unavailable}</Txt></Card>;
  const cheapest = q.competitors.reduce<Quote['competitors'][number] | null>((a, c) => (!a || c.estimate < a.estimate ? c : a), null);
  return (
    <Card selected={selected} onPress={onPress}>
      <Row>
        <Text style={{ fontSize: 30 }}>{vehicleEmoji(q.service)}</Text>
        <View style={{ flex: 1 }}>
          <Txt style={{ fontWeight: '700' }} numberOfLines={1}>{q.label}</Txt>
          <Txt kind="small">{q.min} min · {q.available ? `${q.available} nearby` : 'few nearby'}{q.intercity ? ' · intercity' : ''}</Txt>
          {recommended && <Pill text="Recommended for hill roads" color={t.accent} />}
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Txt kind="price">{q.total === 0 ? 'FREE' : rs(q.total)}</Txt>
          {q.split.promoCost > 0 && <Text style={{ color: t.muted, textDecorationLine: 'line-through', fontSize: 12 }}>{rs(q.gross)}</Text>}
          {cheapest && cheapest.estimate > q.total && <Text style={{ color: t.ok, fontSize: 11, fontWeight: '700' }}>Save {rs(cheapest.estimate - q.total)} vs {cheapest.name}</Text>}
        </View>
      </Row>
    </Card>
  );
}

function TripPanel({ trip, onCancel, onRate, onSos, onDone }: { trip: Trip; onCancel: () => void; onRate: (s: number) => void; onSos: () => void; onDone: () => void }) {
  const t = useTheme();
  const d = trip.driver;
  const is = (...s: string[]) => s.includes(trip.status);
  const live = is('accepted', 'arrived', 'in_progress');
  const bigCode = (label: string, code: string) => <Card><Txt kind="small">{label}</Txt><Text style={[styles.pin, { color: t.brand }]}>{code}</Text></Card>;
  return (
    <ScrollView>
      <Txt kind="h2">{STATUS[trip.status] ?? trip.status}</Txt>
      <Txt kind="muted">{trip.pickup.label} → {trip.drop.label} · {trip.route.km.toFixed(1)} km</Txt>
      {is('searching') && <Txt kind="small" style={{ marginTop: 4 }}>Offering your trip to the nearest drivers…</Txt>}
      {d && (
        <Card>
          <Row>
            <Text style={{ fontSize: 34 }}>{vehicleEmoji(d.vehicle.type)}</Text>
            <View style={{ flex: 1 }}>
              <Txt style={{ fontWeight: '800', fontSize: 17 }}>{d.vehicle.plate}</Txt>
              <Txt kind="small">{d.vehicle.model} · {d.name} ★ {d.rating}{d.fleet ? ' · MyRide fleet' : ''}</Txt>
            </View>
            <RoundButton icon="📞" label="Call driver" onPress={() => call(d.phone)} style={{ backgroundColor: t.bg }} />
          </Row>
        </Card>
      )}
      {is('accepted', 'arrived') && bigCode('Tell your driver this PIN at pickup', trip.pin)}
      {trip.kind === 'delivery' && trip.deliveryOtp && live && bigCode(`Delivery code (also sent to ${trip.recipient?.name} by SMS)`, trip.deliveryOtp)}
      <Row style={{ marginVertical: 6 }}>
        <Txt kind="price">{trip.fare === 0 ? 'FREE' : rs(trip.fare)}</Txt>
        <Txt kind="small">{trip.payment.method}</Txt>
      </Row>
      {live && (
        <Row>
          <Button title="Share trip" kind="ghost" onPress={() => Share.share({ message: `Track my MyRide trip live: ${apiUrlFor(`/track.html?t=${trip.shareToken}`)}` })} style={{ flex: 1 }} />
          <Button title="SOS" kind="danger" onPress={onSos} style={{ flex: 1 }} />
        </Row>
      )}
      {is('searching', 'accepted', 'arrived', 'scheduled') && <Button title="Cancel trip" kind="ghost" onPress={onCancel} style={{ marginTop: 8 }} />}
      {is('completed') && (
        <>
          {trip.quote.lines.map((l, i) => <Row key={i} style={{ justifyContent: 'space-between' }}><Txt kind="small">{l.label}</Txt><Txt kind="small">{l.amount < 0 ? '−' : ''}{rs(Math.abs(l.amount))}</Txt></Row>)}
          <Txt kind="muted" style={{ marginTop: 10 }}>{trip.riderRating ? 'Thanks for rating!' : 'How was your trip?'}</Txt>
          <Row style={{ marginVertical: 6 }}>
            {[1, 2, 3, 4, 5].map((s) => (
              <Pressable key={s} disabled={!!trip.riderRating} onPress={() => onRate(s)} accessibilityLabel={`${s} stars`}>
                <Text style={{ fontSize: 34, color: (trip.riderRating?.stars ?? 0) >= s ? t.accent : t.line }}>★</Text>
              </Pressable>
            ))}
          </Row>
        </>
      )}
      {is('completed', 'cancelled', 'no_driver') && <Button title="Done" onPress={onDone} style={{ marginTop: 6 }} />}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  free: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 99, elevation: 6 },
  freeText: { color: '#fff', fontWeight: '800' },
  tab: { paddingHorizontal: 16, paddingVertical: 9, borderRadius: 99 },
  where: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 12, padding: 14, marginVertical: 4 },
  dot: { width: 12, height: 12, borderRadius: 6 },
  search: { borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  small: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  payChip: { borderWidth: 2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8 },
  pin: { fontSize: 36, fontWeight: '900', letterSpacing: 10, textAlign: 'center' },
});
