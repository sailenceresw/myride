import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppMap, type MapHandle, type MapMarker } from '@/components/AppMap';
import { Avatar, BackHeader, Button, Card, Chip, Icon, Pill, Plate, Pulse, RoundButton, Row, Sheet, Steps, Txt, type IconName } from '@/components/ui';
import { api, apiUrlFor, rs, type Point, type Quote, type Trip } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { call, POLICE } from '@/lib/config';
import { RADIUS, shadow, useTheme, vehicleEmoji } from '@/lib/theme';
import { useLocation } from '@/lib/useLocation';
import { useEvents } from '@/lib/useEvents';
import { usePolling } from '@/lib/usePolling';

type Kind = 'ride' | 'delivery' | 'logistics';
type Place = { id: string; name: string; lat: number; lng: number; category?: string };
type QuoteResp = { route: { km: number; min: number; geometry: [number, number][] }; quotes: Quote[]; pickupWard: string | null; dropWard: string | null; recommend: string | null; promoError: string | null };

const ACTIVE = ['scheduled', 'searching', 'accepted', 'arrived', 'in_progress'];
const KINDS: Record<Kind, [string, IconName]> = { ride: ['Ride', 'car-sport'], delivery: ['Parcel', 'cube'], logistics: ['Logistics', 'bus'] };
const PAYMENTS: Record<'cash' | 'esewa' | 'khalti', [string, IconName]> = { cash: ['Cash', 'cash-outline'], esewa: ['eSewa', 'wallet-outline'], khalti: ['Khalti', 'card-outline'] };
const PLACE_ICON: Record<string, IconName> = { ward: 'home-outline', intercity: 'trail-sign-outline', transport: 'airplane-outline', hospital: 'medkit-outline', tourist: 'camera-outline', commercial: 'storefront-outline' };
const QUICK: Record<string, [string, IconName]> = {
  'pokhara-intl-airport': ['Airport', 'airplane-outline'], 'tourist-bus-park': ['Bus Park', 'bus-outline'], mahendrapul: ['Mahendrapul', 'storefront-outline'],
  lakeside: ['Lakeside', 'boat-outline'], 'prithvi-chowk': ['Prithvi Chowk', 'git-network-outline'], chipledhunga: ['Chipledhunga', 'cart-outline'],
};
const STATUS: Record<string, string> = {
  searching: 'Finding your rider…', accepted: 'Your rider is on the way', arrived: 'Your rider has arrived', in_progress: 'Enjoy your ride',
  completed: 'You have arrived', cancelled: 'Trip cancelled', no_driver: 'No riders available right now', scheduled: 'Scheduled',
};
const STEP_OF: Record<string, number> = { searching: 0, accepted: 1, arrived: 2, in_progress: 3 };
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

export default function RiderHome() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { profile, refresh } = useAuth();
  const map = useRef<MapHandle>(null);
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
  const [sheetH, setSheetH] = useState(300);

  // Default pickup = the user's current location (until they pick another place).
  const here = useMemo(() => (fix ? { lat: fix.lat, lng: fix.lng, label: 'Current location' } : null), [fix]);
  const pickup = pickupChoice ?? here;

  // Start the map on the user's current location (first GPS fix).
  const centred = useRef(false);
  useEffect(() => {
    if (!fix || centred.current) return;
    centred.current = true;
    map.current?.flyTo(fix, { zoom: 16 });
  }, [fix]);

  // Places (landmarks, 33 wards, intercity lanes) and any trip still in progress.
  useEffect(() => {
    Promise.all([api<Place[]>('GET', '/api/places'), api<{ logistics: { destinations: Place[] } }>('GET', '/api/config')])
      .then(([p, c]) => setPlaces([...p, ...c.logistics.destinations.map((d) => ({ ...d, category: 'intercity' }))]))
      .catch(() => {});
    api<Trip[]>('GET', '/api/trips').then((l) => setTrip(l.find((x) => ACTIVE.includes(x.status)) ?? null)).catch(() => {});
  }, []);

  // Live trip updates arrive over SSE; the slow poll only covers a dropped connection.
  const live = !!trip && ACTIVE.includes(trip.status);
  const update = (next: Trip) => {
    if (next.status !== trip?.status) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    setTrip(next);
  };
  useEvents((e) => { if (e.type === 'trip' && e.role === 'rider' && e.trip.id === trip?.id) update(e.trip); }, live);
  usePolling(async () => update(await api<Trip>('GET', `/api/trips/${trip!.id}`)), 15000, live);

  usePolling(async () => setNearby(await api('GET', `/api/nearby?lat=${pickup!.lat}&lng=${pickup!.lng}`)), 8000, !trip && !!pickup);

  const getQuote = useCallback(async (p: Point, d: Point, k: Kind) => {
    setErr(''); setBusy(true);
    try {
      const r = await api<QuoteResp>('POST', '/api/quote', { pickup: p, drop: d, kind: k, parcel: k === 'ride' ? undefined : { weightKg: +weight || 1 } });
      setQuote(r);
      setSel(r.recommend ?? r.quotes.find((q) => !q.unavailable)?.service ?? null);
      if (r.promoError) setErr(r.promoError);
    } catch (e) { setErr((e as Error).message); setQuote(null); }
    setBusy(false);
  }, [weight]);

  const geometry = trip?.route.geometry ?? quote?.route.geometry;
  const routeCoords = useMemo(() => geometry?.map(([lat, lng]) => ({ lat, lng })), [geometry]);
  // Keep the whole route visible above the sheet, whatever its height.
  useEffect(() => {
    if (routeCoords) map.current?.fit(routeCoords, { top: insets.top + 80, right: 48, bottom: sheetH + 24, left: 48 });
  }, [routeCoords, sheetH, insets.top]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return places
      .filter((p) => (kind === 'logistics' || p.category !== 'intercity') && (q ? p.name.toLowerCase().includes(q) : p.category !== 'ward'))
      .slice(0, 40);
  }, [places, query, kind]);
  const quick = useMemo(() => places.filter((p) => p.id in QUICK), [places]);

  function choose(p: Point | null, field = searching) { // null = back to current location
    const nextPickup = field === 'pickup' ? p ?? here : pickup;
    const nextDrop = field === 'drop' ? p : drop;
    if (field === 'pickup') setPickup(p); else setDrop(p);
    setSearching(null);
    setQuery('');
    if (nextPickup && nextDrop) getQuote(nextPickup, nextDrop, kind);
  }
  function chooseKind(k: Kind) {
    setKind(k);
    if (pickup && drop) getQuote(pickup, drop, k);
  }
  const clearDrop = () => { setDrop(null); setQuote(null); setErr(''); if (fix) map.current?.flyTo(fix, { zoom: 16 }); };

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

  const selected = quote?.quotes.find((q) => q.service === sel);
  const pk = trip?.pickup ?? pickup, dp = trip?.drop ?? drop;
  const markers: MapMarker[] = [
    ...(trip ? [] : nearby.map((c, i) => ({ key: `n${i}`, at: c, emoji: vehicleEmoji(c.type), size: 22 }))),
    ...(pk && (drop || trip) ? [{ key: 'pickup', at: pk, color: t.brand, title: 'Pickup' }] : []),
    ...(dp ? [{ key: 'drop', at: dp, color: t.accent, title: 'Drop' }] : []),
    ...(trip?.driver?.loc ? [{ key: 'driver', at: trip.driver.loc, emoji: vehicleEmoji(trip.driver.vehicle.type), size: 30 }] : []),
  ];
  const input = [styles.small, { borderColor: t.line, color: t.ink, backgroundColor: t.bg }];

  // ---------- search screen ----------
  if (searching) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
        <View style={{ paddingHorizontal: 16, gap: 10 }}>
          <BackHeader title={searching === 'pickup' ? 'Pickup point' : 'Where to?'} />
          <View style={[styles.search, shadow(3), { backgroundColor: t.card }]}>
            <Icon name="search" size={20} color={t.muted} />
            <TextInput autoFocus value={query} onChangeText={setQuery} placeholder="Landmark, ward (e.g. Ward 27) or city" placeholderTextColor={t.muted} style={{ flex: 1, fontSize: 16, color: t.ink, paddingVertical: 14 }} />
            {!!query && <Pressable onPress={() => setQuery('')} hitSlop={10}><Icon name="close-circle" size={20} color={t.muted} /></Pressable>}
          </View>
          {searching === 'pickup' && here && <PlaceRow icon="locate" title="Use current location" subtitle="GPS" onPress={() => choose(null)} highlight />}
        </View>
        <FlatList
          data={results}
          keyExtractor={(p) => p.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24 }}
          renderItem={({ item }) => (
            <PlaceRow icon={PLACE_ICON[item.category ?? ''] ?? 'location-outline'} title={item.name} subtitle={item.category === 'intercity' ? 'Intercity · logistics only' : item.category} onPress={() => choose({ lat: item.lat, lng: item.lng, label: item.name })} />
          )}
        />
      </SafeAreaView>
    );
  }

  const first = profile?.name?.split(' ')[0];
  return (
    <View style={{ flex: 1 }}>
      <AppMap ref={map} user={fix} padding={{ bottom: sheetH }} markers={markers} lines={routeCoords ? [{ coords: routeCoords, color: t.ink, width: 5 }] : []} />

      <View style={[styles.top, { top: insets.top + 8 }]}>
        <RoundButton icon="person" label="Account" onPress={() => router.push('/rider/account')} />
        {!trip && !drop && (
          <View style={[styles.hello, shadow(5), { backgroundColor: t.card }]}>
            <Text style={{ color: t.muted, fontSize: 12 }}>{greeting()}</Text>
            <Text style={{ color: t.ink, fontWeight: '800', fontSize: 15 }} numberOfLines={1}>{first ? `${first}, where to?` : 'Where to?'}</Text>
          </View>
        )}
        <View style={{ flex: 1 }} />
        {profile?.membership.active && <Pill icon="star" text="PLUS" color={t.accent} />}
        {profile?.firstRideFree && !trip && <Pill icon="gift" text="1st ride free" color={t.ok} />}
      </View>

      {!trip && fix && <RoundButton icon="locate" label="Recenter on my location" onPress={() => map.current?.flyTo(fix, { zoom: 16 })} style={{ position: 'absolute', right: 14, bottom: sheetH + 14 }} />}

      <Sheet
        onHeight={setSheetH}
        footer={!trip && selected ? (
          <>
            <Row>{(Object.keys(PAYMENTS) as (keyof typeof PAYMENTS)[]).map((p) => <Chip key={p} label={PAYMENTS[p][0]} icon={PAYMENTS[p][1]} active={payment === p} onPress={() => setPayment(p)} />)}</Row>
            <Button title={`Book ${selected.label.replace('MyRide ', '')} · ${selected.total === 0 ? 'FREE' : rs(selected.total)}`} onPress={book} loading={busy} kind="dark" />
          </>
        ) : undefined}
      >
        {trip ? (
          <TripPanel trip={trip} onCancel={() => tripAction('cancel', { reason: 'rider_cancelled' })} onRate={rate} onSos={sos} onDone={reset} />
        ) : (
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Row style={{ marginBottom: 12 }}>
              {(Object.keys(KINDS) as Kind[]).map((k) => <Chip key={k} label={KINDS[k][0]} icon={KINDS[k][1]} active={kind === k} onPress={() => chooseKind(k)} />)}
            </Row>

            {!drop ? (
              <>
                <Pressable onPress={() => setSearching('drop')} style={[styles.whereTo, { backgroundColor: t.chip }]} accessibilityRole="search">
                  <Icon name="search" size={22} />
                  <Text style={{ flex: 1, fontSize: 19, fontWeight: '800', color: t.ink }}>Where to?</Text>
                  <View style={[styles.now, { backgroundColor: t.card }]}><Icon name="time-outline" size={15} /><Text style={{ fontWeight: '700', color: t.ink, fontSize: 13 }}>Now</Text></View>
                </Pressable>
                <Pressable onPress={() => setSearching('pickup')} style={styles.from}>
                  <View style={[styles.dot, { backgroundColor: t.brand }]} />
                  <Txt kind="muted" numberOfLines={1} style={{ flex: 1 }}>Pickup: <Text style={{ color: t.ink, fontWeight: '700' }}>{pickup?.label ?? 'Locating you…'}</Text></Txt>
                  <Icon name="pencil" size={15} color={t.muted} />
                </Pressable>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 4 }}>
                  {quick.map((p) => <Chip key={p.id} label={QUICK[p.id][0]} icon={QUICK[p.id][1]} onPress={() => choose({ lat: p.lat, lng: p.lng, label: p.name }, 'drop')} />)}
                </ScrollView>
                <Row style={{ marginTop: 12 }}>
                  <Icon name="shield-checkmark" size={16} color={t.ok} />
                  <Txt kind="small" style={{ flex: 1 }}>Fixed fares under the legal maximum. No surge pricing, ever.</Txt>
                </Row>
              </>
            ) : (
              <>
                <View style={[styles.route, { backgroundColor: t.chip }]}>
                  <View style={{ alignItems: 'center', gap: 3 }}>
                    <View style={[styles.dot, { backgroundColor: t.brand }]} /><View style={{ width: 2, height: 18, backgroundColor: t.line }} /><View style={[styles.dot, { backgroundColor: t.accent, borderRadius: 2 }]} />
                  </View>
                  <View style={{ flex: 1, gap: 14 }}>
                    <Pressable onPress={() => setSearching('pickup')}><Txt numberOfLines={1}>{pickup?.label ?? 'Locating you…'}</Txt></Pressable>
                    <Pressable onPress={() => setSearching('drop')}><Txt numberOfLines={1} style={{ fontWeight: '800' }}>{drop.label}</Txt></Pressable>
                  </View>
                  <Pressable onPress={clearDrop} hitSlop={10} accessibilityLabel="Clear destination"><Icon name="close" size={22} color={t.muted} /></Pressable>
                </View>
                {!!quote && <Txt kind="small" style={{ marginVertical: 6 }}>{quote.route.km.toFixed(1)} km · {Math.round(quote.route.min)} min{quote.pickupWard ? ` · ${quote.pickupWard}` : ''}{quote.dropWard ? ` → ${quote.dropWard}` : ''}</Txt>}

                {kind !== 'ride' && (
                  <View style={{ gap: 8, marginVertical: 6 }}>
                    <Row>
                      <TextInput value={weight} onChangeText={setWeight} onEndEditing={() => pickup && getQuote(pickup, drop, kind)} keyboardType="decimal-pad" placeholder="kg" placeholderTextColor={t.muted} style={[...input, { width: 76 }]} />
                      <Txt kind="small">kg</Txt>
                      <TextInput value={receiver.name} onChangeText={(name) => setReceiver({ ...receiver, name })} placeholder="Receiver name" placeholderTextColor={t.muted} style={[...input, { flex: 1 }]} />
                    </Row>
                    <TextInput value={receiver.phone} onChangeText={(phone) => setReceiver({ ...receiver, phone: phone.replace(/\D/g, '').slice(0, 10) })} keyboardType="phone-pad" placeholder="Receiver mobile 98XXXXXXXX" placeholderTextColor={t.muted} style={input} />
                  </View>
                )}

                {busy && !quote && <Txt kind="muted" style={{ marginVertical: 12 }}>Finding the best fares…</Txt>}
                {quote?.quotes.map((q) => <QuoteRow key={q.service} q={q} selected={q.service === sel} recommended={quote.recommend === q.service} onPress={() => !q.unavailable && setSel(q.service)} />)}
              </>
            )}
            {!!err && <Row style={{ marginVertical: 6 }}><Icon name="alert-circle" size={18} color={t.danger} /><Text style={{ color: t.danger, flex: 1 }}>{err}</Text></Row>}
          </ScrollView>
        )}
      </Sheet>
    </View>
  );
}

function PlaceRow({ icon, title, subtitle, onPress, highlight }: { icon: IconName; title: string; subtitle?: string; onPress: () => void; highlight?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.result, { borderColor: t.line, opacity: pressed ? 0.6 : 1 }]}>
      <View style={[styles.placeIcon, { backgroundColor: highlight ? t.brand : t.chip }]}><Icon name={icon} size={18} color={highlight ? '#fff' : t.ink} /></View>
      <View style={{ flex: 1 }}><Txt style={{ fontWeight: '600' }} numberOfLines={1}>{title}</Txt>{!!subtitle && <Txt kind="small" style={{ textTransform: 'capitalize' }}>{subtitle}</Txt>}</View>
    </Pressable>
  );
}

function QuoteRow({ q, selected, recommended, onPress }: { q: Quote; selected: boolean; recommended: boolean; onPress: () => void }) {
  const t = useTheme();
  if (q.unavailable) return <View style={[styles.quote, { opacity: 0.45 }]}><Text style={styles.qIcon}>{vehicleEmoji(q.service)}</Text><View style={{ flex: 1 }}><Txt style={{ fontWeight: '700' }}>{q.label}</Txt><Txt kind="small">{q.unavailable}</Txt></View></View>;
  const cheapest = q.competitors.reduce<Quote['competitors'][number] | null>((a, c) => (!a || c.estimate < a.estimate ? c : a), null);
  const save = cheapest && cheapest.estimate > q.total ? cheapest.estimate - q.total : 0;
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.quote, { backgroundColor: selected ? t.brandSoft : 'transparent', borderColor: selected ? t.brand : 'transparent' }]}>
      <Text style={styles.qIcon}>{vehicleEmoji(q.service)}</Text>
      <View style={{ flex: 1, gap: 2 }}>
        <Txt style={{ fontWeight: '800' }} numberOfLines={1}>{q.label.replace('MyRide ', '')}</Txt>
        <Txt kind="small">{q.min} min · {q.available ? `${q.available} nearby` : 'few nearby'}{q.intercity ? ' · intercity' : ''}</Txt>
        <Row style={{ gap: 6 }}>
          {recommended && <Pill text="Best for hills" color={t.accent} tint={t.accentSoft} icon="trending-up" />}
          {save > 0 && <Pill text={`Save ${rs(save)} vs ${cheapest!.name}`} color={t.ok} tint={t.okSoft} />}
        </Row>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Txt kind="price" style={{ color: q.total === 0 ? t.ok : t.ink }}>{q.total === 0 ? 'FREE' : rs(q.total)}</Txt>
        {q.split.promoCost > 0 && <Text style={{ color: t.muted, textDecorationLine: 'line-through', fontSize: 12 }}>{rs(q.gross)}</Text>}
      </View>
    </Pressable>
  );
}

function TripPanel({ trip, onCancel, onRate, onSos, onDone }: { trip: Trip; onCancel: () => void; onRate: (s: number) => void; onSos: () => void; onDone: () => void }) {
  const t = useTheme();
  const d = trip.driver;
  const is = (...s: string[]) => s.includes(trip.status);
  const live = is('accepted', 'arrived', 'in_progress');
  const share = () => Share.share({ message: `Track my MyRide trip live: ${apiUrlFor(`/track.html?t=${trip.shareToken}`)}` });
  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Txt kind="h1">{STATUS[trip.status] ?? trip.status}</Txt>
          <Txt kind="muted" numberOfLines={1}>{trip.pickup.label} → {trip.drop.label} · {trip.route.km.toFixed(1)} km</Txt>
        </View>
        {is('searching') && <Pulse size={52} color={t.brand}><View style={[styles.pulseCore, { backgroundColor: t.brand }]}><Text style={{ fontSize: 22 }}>{vehicleEmoji(trip.service)}</Text></View></Pulse>}
      </Row>
      {trip.status in STEP_OF && <Steps steps={['Booked', 'Coming', 'Pickup', 'On trip']} at={STEP_OF[trip.status]} />}
      {is('searching') && <Txt kind="small">Offering your trip to the nearest riders…</Txt>}

      {d && (
        <Card raised style={{ marginTop: 8 }}>
          <Row style={{ gap: 12 }}>
            <Avatar name={d.name} size={52} />
            <View style={{ flex: 1, gap: 3 }}>
              <Row style={{ gap: 6 }}><Txt style={{ fontWeight: '800' }}>{d.name}</Txt><Icon name="star" size={13} color={t.accent} /><Txt kind="small">{d.rating}</Txt></Row>
              <Txt kind="small">{d.vehicle.model}{d.fleet ? ' · MyRide fleet' : ''}</Txt>
              <Plate text={d.vehicle.plate} />
            </View>
            <Text style={{ fontSize: 40 }}>{vehicleEmoji(d.vehicle.type)}</Text>
          </Row>
        </Card>
      )}

      {is('accepted', 'arrived') && <Code label="Tell your rider this PIN at pickup" code={trip.pin} />}
      {trip.kind === 'delivery' && trip.deliveryOtp && live && <Code label={`Delivery code (also sent to ${trip.recipient?.name} by SMS)`} code={trip.deliveryOtp} />}

      {live && d && (
        <Row style={{ marginTop: 10 }}>
          <Action icon="call" label="Call" onPress={() => call(d.phone)} />
          <Action icon="share-social" label="Share trip" onPress={share} />
          <Action icon="warning" label="SOS" onPress={onSos} danger />
        </Row>
      )}

      {!is('completed') && (
        <Row style={{ justifyContent: 'space-between', marginTop: 12 }}>
          <Row><Icon name={trip.payment.method === 'cash' ? 'cash-outline' : 'wallet-outline'} size={18} color={t.muted} /><Txt kind="muted" style={{ textTransform: 'capitalize' }}>{trip.payment.method}</Txt></Row>
          <Txt kind="price" style={{ color: trip.fare === 0 ? t.ok : t.ink }}>{trip.fare === 0 ? 'FREE' : rs(trip.fare)}</Txt>
        </Row>
      )}

      {is('completed') && (
        <Card style={{ marginTop: 10, backgroundColor: t.bg }}>
          {trip.quote.lines.map((l, i) => <Row key={i} style={{ justifyContent: 'space-between', marginVertical: 2 }}><Txt kind="muted">{l.label}</Txt><Txt kind="muted">{l.amount < 0 ? '−' : ''}{rs(Math.abs(l.amount))}</Txt></Row>)}
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.line, marginVertical: 8 }} />
          <Row style={{ justifyContent: 'space-between' }}><Txt style={{ fontWeight: '800' }}>Total · {trip.payment.method}</Txt><Txt kind="price" style={{ color: trip.fare === 0 ? t.ok : t.ink }}>{trip.fare === 0 ? 'FREE' : rs(trip.fare)}</Txt></Row>
        </Card>
      )}
      {is('completed') && (
        <View style={{ alignItems: 'center', marginTop: 8 }}>
          <Txt kind="muted">{trip.riderRating ? 'Thanks for rating!' : `How was your trip with ${d?.name.split(' ')[0] ?? 'your rider'}?`}</Txt>
          <Row style={{ marginVertical: 4, gap: 6 }}>
            {[1, 2, 3, 4, 5].map((s) => (
              <Pressable key={s} disabled={!!trip.riderRating} onPress={() => onRate(s)} accessibilityLabel={`${s} stars`} hitSlop={4}>
                <Icon name={(trip.riderRating?.stars ?? 0) >= s ? 'star' : 'star-outline'} size={36} color={(trip.riderRating?.stars ?? 0) >= s ? t.accent : t.line} />
              </Pressable>
            ))}
          </Row>
        </View>
      )}

      {is('searching', 'accepted', 'arrived', 'scheduled') && <Button title="Cancel trip" kind="ghost" onPress={onCancel} style={{ marginTop: 12 }} />}
      {is('completed', 'cancelled', 'no_driver') && <Button title={is('completed') ? 'Done' : 'Book again'} onPress={onDone} style={{ marginTop: 10 }} />}
    </ScrollView>
  );
}

function Action({ icon, label, onPress, danger }: { icon: IconName; label: string; onPress: () => void; danger?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.action, { backgroundColor: danger ? t.dangerSoft : t.chip, opacity: pressed ? 0.7 : 1 }]}>
      <Icon name={icon} size={20} color={danger ? t.danger : t.ink} /><Text style={{ fontSize: 12, fontWeight: '700', color: danger ? t.danger : t.ink }}>{label}</Text>
    </Pressable>
  );
}

function Code({ label, code }: { label: string; code: string }) {
  const t = useTheme();
  return (
    <View style={{ marginTop: 12, gap: 8 }}>
      <Txt kind="small">{label}</Txt>
      <Row style={{ gap: 8 }}>
        {code.split('').map((c, i) => <View key={i} style={[styles.codeBox, { backgroundColor: t.brandSoft }]}><Text style={{ fontSize: 28, fontWeight: '900', color: t.brand }}>{c}</Text></View>)}
      </Row>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: 14, right: 14, flexDirection: 'row', alignItems: 'center', gap: 10 },
  hello: { borderRadius: RADIUS.pill, paddingHorizontal: 16, paddingVertical: 7, maxWidth: '62%' },
  whereTo: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.md, paddingHorizontal: 16, paddingVertical: 15 },
  now: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 6 },
  from: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 4 },
  route: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.md, padding: 14 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: RADIUS.md, paddingHorizontal: 14 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  placeIcon: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  small: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  quote: { flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: RADIUS.md, borderWidth: 2, paddingHorizontal: 10, paddingVertical: 10, marginVertical: 2 },
  qIcon: { fontSize: 34, width: 46, textAlign: 'center' },
  action: { flex: 1, alignItems: 'center', gap: 4, borderRadius: RADIUS.md, paddingVertical: 12 },
  pulseCore: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  codeBox: { width: 54, height: 62, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
});
